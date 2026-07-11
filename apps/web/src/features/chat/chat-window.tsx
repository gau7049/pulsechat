import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CLIENT_EVENTS, type ConversationDto, type MessageDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../auth/auth-context';
import { getTypingSnapshot, setActiveConversation, typingEmitter } from './chat-live-store';
import { conversationTitle, lastSeenLabel, otherMember } from './conversation-utils';
import { MessageBubble } from './message-bubble';
import { sendAck, useMessages, useOutboxFor, useRetryMessage, useSendMessage } from './use-chat';

/**
 * The conversation view (§14.1): history with upward infinite scroll, live
 * bubbles, typing indicator, presence header, and the composer with the
 * §21.2 pending/failed/retry states.
 */
export function ChatWindow({ conversation }: { conversation: ConversationDto }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesQuery = useMessages(conversation.id);
  const outboxEntries = useOutboxFor(conversation.id);
  const retry = useRetryMessage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => {
    const items = messagesQuery.data?.pages.flatMap((page) => page.items) ?? [];
    // Pages arrive newest-first; render oldest-first.
    return [...items].sort((a, b) => a.sequence - b.sequence);
  }, [messagesQuery.data]);

  const topSequence = messages.at(-1)?.sequence ?? 0;

  // While this conversation is on screen, everything in it counts as read.
  useEffect(() => {
    setActiveConversation(conversation.id);
    return () => setActiveConversation(null);
  }, [conversation.id]);

  useEffect(() => {
    if (topSequence > 0 && document.visibilityState === 'visible') {
      sendAck(queryClient, conversation.id, topSequence, 'read');
    }
  }, [queryClient, conversation.id, topSequence]);

  // Pin to bottom on new content unless the reader scrolled up into history.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, outboxEntries.length]);

  // Upward infinite scroll (§14.1): the sentinel above the oldest message.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (
          observed[0]?.isIntersecting &&
          messagesQuery.hasNextPage &&
          !messagesQuery.isFetchingNextPage
        ) {
          const before = root.scrollHeight;
          void messagesQuery.fetchNextPage().then(() => {
            // Keep the viewport anchored on the previously-visible message.
            requestAnimationFrame(() => {
              root.scrollTop += root.scrollHeight - before;
            });
          });
        }
      },
      { root, rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [messagesQuery]);

  if (!user) return null;

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={conversationTitle(conversation, user.id)}
    >
      <ChatHeader conversation={conversation} myId={user.id} />

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-2 overflow-y-auto px-4 py-3"
      >
        <div ref={topSentinelRef} />
        {messagesQuery.isLoading && (
          <div aria-hidden>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}
        {messagesQuery.isError && (
          <EmptyState
            icon="⚠️"
            title="Could not load messages"
            action={
              <Button variant="secondary" onClick={() => void messagesQuery.refetch()}>
                Retry
              </Button>
            }
          />
        )}
        {messagesQuery.isFetchingNextPage && <SkeletonRow />}
        {!messagesQuery.isLoading && messages.length === 0 && outboxEntries.length === 0 && (
          <EmptyState
            icon="💬"
            title="Say hello"
            description="Messages are end-to-end protected — the server only ever sees ciphertext."
          />
        )}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            userId={user.id}
            conversation={conversation}
            message={message}
          />
        ))}
        {outboxEntries.map((entry) => (
          <MessageBubble
            key={entry.clientUuid}
            userId={user.id}
            conversation={conversation}
            message={outboxEntryAsMessage(entry, user.id)}
            localState={entry.status}
            onRetry={entry.status === 'failed' ? () => retry(entry.clientUuid) : undefined}
          />
        ))}
        <TypingLine conversationId={conversation.id} />
      </div>

      <Composer conversation={conversation} userId={user.id} />
    </section>
  );
}

function outboxEntryAsMessage(
  entry: {
    clientUuid: string;
    conversationId: string;
    ciphertext: string;
    nonce: string;
    createdAt: string;
  },
  userId: string,
): MessageDto {
  return {
    id: entry.clientUuid,
    conversationId: entry.conversationId,
    senderId: userId,
    ciphertext: entry.ciphertext,
    nonce: entry.nonce,
    sequence: Number.MAX_SAFE_INTEGER,
    clientUuid: entry.clientUuid,
    replyToId: null,
    editedAt: null,
    deletedForEveryoneAt: null,
    createdAt: entry.createdAt,
  };
}

function ChatHeader({ conversation, myId }: { conversation: ConversationDto; myId: string }) {
  const other = otherMember(conversation, myId);
  const subtitle =
    conversation.type === 'group' ? `${conversation.members.length} members` : lastSeenLabel(other);

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <Link
        to="/chats"
        className="text-fg-muted hover:text-fg md:hidden"
        aria-label="Back to chats"
      >
        ←
      </Link>
      {conversation.type === 'direct' && other ? (
        <Link to={`/u/${other.user.username}`} className="flex min-w-0 items-center gap-3">
          <Avatar
            name={other.user.displayName}
            src={other.user.avatarUrl}
            size="sm"
            online={other.online}
          />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">
              {other.user.displayName}
            </span>
            {subtitle && <span className="block text-xs text-fg-muted">{subtitle}</span>}
          </span>
        </Link>
      ) : (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={conversation.name ?? 'Group'} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">
              {conversation.name}
            </span>
            <span className="block truncate text-xs text-fg-muted">{subtitle}</span>
          </span>
        </span>
      )}
    </header>
  );
}

function TypingLine({ conversationId }: { conversationId: string }) {
  const typing = useSyncExternalStore(typingEmitter.subscribe, () =>
    getTypingSnapshot(conversationId),
  );
  if (typing.length === 0) return null;
  const names = typing.map((t) => t.displayName).join(', ');
  return (
    <p role="status" className="px-1 text-xs text-fg-muted italic">
      {names} {typing.length === 1 ? 'is' : 'are'} typing…
    </p>
  );
}

function Composer({ conversation, userId }: { conversation: ConversationDto; userId: string }) {
  const { toast } = useToast();
  const send = useSendMessage(userId, conversation);
  const [draft, setDraft] = useState('');
  const typingUntil = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActive = useRef(false);

  function signalTyping(): void {
    const socket = getSocket();
    if (!socket?.connected) return;
    if (!typingActive.current) {
      typingActive.current = true;
      socket.emit(CLIENT_EVENTS.TYPING_START, { conversationId: conversation.id });
    }
    if (typingUntil.current) clearTimeout(typingUntil.current);
    typingUntil.current = setTimeout(stopTyping, 2500);
  }

  function stopTyping(): void {
    if (!typingActive.current) return;
    typingActive.current = false;
    getSocket()?.emit(CLIENT_EVENTS.TYPING_STOP, { conversationId: conversation.id });
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    stopTyping();
    try {
      await send(text);
    } catch (error) {
      setDraft(text);
      toast(error instanceof Error ? error.message : 'Could not send the message', {
        kind: 'error',
      });
    }
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="flex items-end gap-2 border-t border-border px-3 py-2.5"
    >
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          signalTyping();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void onSubmit(e);
          }
        }}
        onBlur={stopTyping}
        rows={Math.min(4, Math.max(1, draft.split('\n').length))}
        placeholder="Type a message…"
        aria-label="Message"
        className="max-h-32 flex-1 resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent"
      />
      <Button type="submit" size="md" disabled={draft.trim().length === 0} aria-label="Send">
        Send
      </Button>
    </form>
  );
}
