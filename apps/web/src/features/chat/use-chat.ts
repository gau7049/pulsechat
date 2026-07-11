import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type AddMemberBody,
  type ConversationDto,
  type CreateConversationBody,
  type MessageDto,
  type MessageSendAck,
  type MessageStatusDto,
  type MessageStatusEventPayload,
  type MessageSyncAck,
  type Page,
  type PresenceUpdatePayload,
  type TypingEventPayload,
} from '@pulsechat/shared';
import { del, get, post } from '../../lib/api';
import { getSocket } from '../../lib/socket';
import { getConversationKey } from './chat-keys';
import { encryptMessage } from '../../lib/crypto/conversation-keys';
import * as outbox from './outbox';
import { getActiveConversation, recordAck, setTyping } from './chat-live-store';

/**
 * Server state + live socket reconciliation for chat. React Query holds the
 * durable views (conversations, history pages); socket events patch those
 * caches in place so the UI moves without refetch storms (§21.1–21.2).
 */

const conversationsKey = ['chat', 'conversations'] as const;
const messagesKey = (conversationId: string) => ['chat', 'messages', conversationId] as const;

type MessagesData = InfiniteData<Page<MessageDto>>;

export function useConversations() {
  return useQuery({
    queryKey: conversationsKey,
    queryFn: () => get<{ items: ConversationDto[] }>('/conversations'),
    staleTime: 10_000,
  });
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: messagesKey(conversationId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      get<Page<MessageDto>>(
        `/conversations/${conversationId}/messages${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useCreateConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateConversationBody) =>
      post<{ conversation: ConversationDto }>('/conversations', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

export function useAddMember(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMemberBody) =>
      post<{ ok: true }>(`/conversations/${conversationId}/members`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

export function useLeaveConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; userId: string }) =>
      del<{ ok: true }>(`/conversations/${input.conversationId}/members/${input.userId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: conversationsKey }),
  });
}

export function useMessageStatuses(messageId: string | null) {
  return useQuery({
    queryKey: ['chat', 'statuses', messageId],
    enabled: messageId !== null,
    queryFn: () => get<{ items: MessageStatusDto[] }>(`/messages/${messageId}/statuses`),
  });
}

// ── Cache surgery ────────────────────────────────────────────────────────────

/** Prepends a message to the newest history page, deduping by id/clientUuid. */
function insertMessage(queryClient: QueryClient, message: MessageDto): void {
  queryClient.setQueryData<MessagesData>(messagesKey(message.conversationId), (data) => {
    if (!data || data.pages.length === 0) return data;
    const exists = data.pages.some((page) =>
      page.items.some((m) => m.id === message.id || m.clientUuid === message.clientUuid),
    );
    if (exists) return data;
    const [first, ...rest] = data.pages;
    return {
      ...data,
      pages: [{ ...first!, items: [message, ...first!.items] }, ...rest],
    };
  });
}

function patchConversations(
  queryClient: QueryClient,
  patch: (items: ConversationDto[]) => ConversationDto[],
): void {
  queryClient.setQueryData<{ items: ConversationDto[] }>(conversationsKey, (data) =>
    data ? { items: patch(data.items) } : data,
  );
}

function bumpConversation(queryClient: QueryClient, message: MessageDto, ownUserId: string): void {
  patchConversations(queryClient, (items) => {
    const target = items.find((c) => c.id === message.conversationId);
    if (!target) {
      // Unknown conversation (created elsewhere) — a refetch will pick it up.
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
      return items;
    }
    const isOwn = message.senderId === ownUserId;
    const viewing = getActiveConversation() === message.conversationId;
    const updated: ConversationDto = {
      ...target,
      lastMessage: message,
      unreadCount: isOwn || viewing ? target.unreadCount : target.unreadCount + 1,
    };
    return [updated, ...items.filter((c) => c.id !== target.id)];
  });
}

export function zeroUnread(queryClient: QueryClient, conversationId: string): void {
  patchConversations(queryClient, (items) =>
    items.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
  );
}

// ── Sending with the offline queue (§21.2) ───────────────────────────────────

async function attemptSend(queryClient: QueryClient, entry: outbox.OutboxEntry): Promise<void> {
  const socket = getSocket();
  // Disconnected: stay queued; the connect handler flushes the outbox.
  if (!socket?.connected) return;
  try {
    const ack = (await socket.timeout(8000).emitWithAck(CLIENT_EVENTS.MESSAGE_SEND, {
      conversationId: entry.conversationId,
      clientUuid: entry.clientUuid,
      ciphertext: entry.ciphertext,
      nonce: entry.nonce,
    })) as MessageSendAck;
    if (ack.ok) {
      outbox.remove(entry.clientUuid);
      insertMessage(queryClient, ack.message);
      patchConversations(queryClient, (items) =>
        items.map((c) => (c.id === entry.conversationId ? { ...c, lastMessage: ack.message } : c)),
      );
    } else {
      outbox.markFailed(entry.clientUuid);
    }
  } catch {
    // Ack timeout — §21.2 pending/failed state with manual retry.
    outbox.markFailed(entry.clientUuid);
  }
}

export function useSendMessage(userId: string, conversation: ConversationDto) {
  const queryClient = useQueryClient();
  return useCallback(
    async (plaintext: string) => {
      const key = await getConversationKey(userId, conversation);
      if (!key) throw new Error('This conversation cannot be decrypted on this device');
      const { ciphertext, nonce } = await encryptMessage(key, plaintext);
      const entry: Omit<outbox.OutboxEntry, 'status'> = {
        clientUuid: crypto.randomUUID(),
        conversationId: conversation.id,
        ciphertext,
        nonce,
        createdAt: new Date().toISOString(),
      };
      outbox.enqueue(entry);
      void attemptSend(queryClient, { ...entry, status: 'pending' });
    },
    [queryClient, userId, conversation],
  );
}

export function useRetryMessage() {
  const queryClient = useQueryClient();
  return useCallback(
    (clientUuid: string) => {
      outbox.markPending(clientUuid);
      const entry = outbox.getEntries().find((e) => e.clientUuid === clientUuid);
      if (entry) void attemptSend(queryClient, { ...entry, status: 'pending' });
    },
    [queryClient],
  );
}

export function useOutboxFor(conversationId: string): outbox.OutboxEntry[] {
  const entries = useSyncExternalStore(outbox.subscribe, outbox.getEntries);
  return entries.filter((e) => e.conversationId === conversationId);
}

/** Read/delivered acknowledgement — also zeroes the local unread badge. */
export function sendAck(
  queryClient: QueryClient,
  conversationId: string,
  upToSequence: number,
  state: 'delivered' | 'read',
): void {
  if (upToSequence < 1) return;
  getSocket()?.emit(CLIENT_EVENTS.MESSAGE_ACK, { conversationId, upToSequence, state });
  if (state === 'read') zeroUnread(queryClient, conversationId);
}

// ── Socket bridge (mounted once inside the signed-in shell) ──────────────────

export function useChatSocketBridge(userId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    if (!socket) return;

    const onMessageNew = (message: MessageDto) => {
      insertMessage(queryClient, message);
      bumpConversation(queryClient, message, userId);
      if (message.senderId !== userId) {
        const viewing =
          getActiveConversation() === message.conversationId &&
          document.visibilityState === 'visible';
        sendAck(
          queryClient,
          message.conversationId,
          message.sequence,
          viewing ? 'read' : 'delivered',
        );
      }
    };

    const onMessageStatus = (event: MessageStatusEventPayload) => {
      recordAck(event.conversationId, event.userId, event.state, event.upToSequence);
    };

    const onTyping = (event: TypingEventPayload) => {
      setTyping(
        event.conversationId,
        { userId: event.userId, displayName: event.displayName },
        event.typing,
      );
    };

    const onPresence = (event: PresenceUpdatePayload) => {
      patchConversations(queryClient, (items) =>
        items.map((conversation) => ({
          ...conversation,
          members: conversation.members.map((member) =>
            member.user.id === event.userId
              ? { ...member, online: event.online, lastSeenAt: event.lastSeenAt }
              : member,
          ),
        })),
      );
    };

    const onNotification = (event: { type?: string }) => {
      if (event.type === 'conversation_new') {
        void queryClient.invalidateQueries({ queryKey: conversationsKey });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['social'] });
      }
    };

    const onConnect = () => {
      // §21.2 reconciliation: flush queued sends, then replay sequence gaps.
      for (const entry of outbox.pendingEntries()) {
        void attemptSend(queryClient, entry);
      }
      const cached = queryClient.getQueriesData<MessagesData>({
        queryKey: ['chat', 'messages'],
      });
      const known = cached.flatMap(([key, data]) => {
        const conversationId = key[2] as string;
        const top = data?.pages[0]?.items[0]?.sequence ?? 0;
        return data ? [{ conversationId, lastSequence: top }] : [];
      });
      if (known.length > 0) {
        void socket
          .timeout(10000)
          .emitWithAck(CLIENT_EVENTS.MESSAGE_SYNC, { conversations: known })
          .then((ack: MessageSyncAck) => {
            if (!ack.ok) return;
            for (const message of ack.messages) {
              insertMessage(queryClient, message);
              bumpConversation(queryClient, message, userId);
            }
          })
          .catch(() => undefined);
      }
      void queryClient.invalidateQueries({ queryKey: conversationsKey });
    };

    socket.on(SERVER_EVENTS.MESSAGE_NEW, onMessageNew);
    socket.on(SERVER_EVENTS.MESSAGE_STATUS, onMessageStatus);
    socket.on(SERVER_EVENTS.TYPING_UPDATE, onTyping);
    socket.on(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
    socket.on(SERVER_EVENTS.NOTIFICATION_NEW, onNotification);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();

    const heartbeat = setInterval(() => {
      if (socket.connected) socket.emit(CLIENT_EVENTS.PRESENCE_HEARTBEAT);
    }, 60_000);

    return () => {
      socket.off(SERVER_EVENTS.MESSAGE_NEW, onMessageNew);
      socket.off(SERVER_EVENTS.MESSAGE_STATUS, onMessageStatus);
      socket.off(SERVER_EVENTS.TYPING_UPDATE, onTyping);
      socket.off(SERVER_EVENTS.PRESENCE_UPDATE, onPresence);
      socket.off(SERVER_EVENTS.NOTIFICATION_NEW, onNotification);
      socket.off('connect', onConnect);
      clearInterval(heartbeat);
    };
  }, [queryClient, userId]);
}
