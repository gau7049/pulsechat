import type { Message } from '@prisma/client';
import {
  SERVER_EVENTS,
  type ConversationDto,
  type ConversationMemberDto,
  type CreateConversationBody,
  type MessageAckPayload,
  type MessageAggregateState,
  type MessageDto,
  type MessageSendPayload,
  type MessageStatusDto,
  type MessageStatusEventPayload,
  type Page,
  type StarredMessageDto,
} from '@pulsechat/shared';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../http/errors.js';
import * as chat from '../repositories/chat.repository.js';
import type {
  ConversationWithMembers,
  MemberWithUser,
  MessageWithMeta,
} from '../repositories/chat.repository.js';
import * as social from '../repositories/social.repository.js';
import { isOnline, lastSeenFor, visiblePresence } from './presence.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Messaging core (Requirement Scope §14–15, §21): friendship-gated
 * conversations, server-assigned total order, per-recipient delivery state,
 * and mutual read-receipt opt-out. Content is ciphertext throughout.
 */

const SEQUENCE_RETRIES = 3;
const SYNC_CAP_PER_CONVERSATION = 200;

// ── Serialization ────────────────────────────────────────────────────────────

/** Meta defaults cover paths where a message is brand new (no reactions yet). */
export function toMessageDto(
  message: Message | MessageWithMeta,
  aggregateState?: MessageAggregateState,
): MessageDto {
  const withMeta = message as Partial<MessageWithMeta>;
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    sequence: message.sequence,
    clientUuid: message.clientUuid,
    replyToId: message.replyToId,
    forwardedFromId: message.forwardedFromId,
    editedAt: message.editedAt?.toISOString() ?? null,
    deletedForEveryoneAt: message.deletedForEveryoneAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    reactions: (withMeta.reactions ?? []).map((r) => ({ userId: r.userId, emoji: r.emoji })),
    starred: (withMeta.stars ?? []).length > 0,
    ...(aggregateState ? { aggregateState } : {}),
  };
}

async function toMemberDtos(
  viewerId: string,
  members: MemberWithUser[],
): Promise<ConversationMemberDto[]> {
  const lastSeen = await lastSeenFor(members.map((m) => m.userId));
  return Promise.all(
    members.map(async (member) => {
      const presence = await visiblePresence(
        viewerId,
        {
          id: member.userId,
          lastSeenVisibility: member.user.privacy?.lastSeenVisibility ?? 'everyone',
        },
        lastSeen.get(member.userId) ?? null,
      );
      return {
        user: toUserSummaryDto(member.user),
        role: member.role,
        joinedAt: member.joinedAt.toISOString(),
        ...presence,
      };
    }),
  );
}

async function toConversationDto(
  viewerId: string,
  conversation: ConversationWithMembers,
  lastMessage: Message | null,
): Promise<ConversationDto> {
  const me = conversation.members.find((m) => m.userId === viewerId);
  if (!me) throw new AppError('NOT_FOUND', 'Conversation not found');
  return {
    id: conversation.id,
    type: conversation.type,
    name: conversation.name,
    createdAt: conversation.createdAt.toISOString(),
    members: await toMemberDtos(viewerId, conversation.members),
    myWrappedKey: me.wrappedKey,
    lastMessage: lastMessage ? toMessageDto(lastMessage) : null,
    unreadCount: await chat.countUnread(conversation.id, viewerId, me.clearedAt),
    pinned: me.pinned,
    muted: me.muted,
    archived: me.archived,
  };
}

// ── Read-receipt visibility (§14.1 mutual opt-out) ───────────────────────────

function readReceiptsOn(member: MemberWithUser | undefined): boolean {
  return member?.user.privacy?.readReceipts ?? true;
}

/**
 * A read only surfaces as "read" when both sides kept read receipts on;
 * otherwise it degrades to "delivered". The database always stores the truth
 * (unread counts need it) — only presentation degrades.
 */
function effectiveState(
  state: 'notified' | 'delivered' | 'read',
  readerOptedOut: boolean,
  viewerOptedOut: boolean,
): 'notified' | 'delivered' | 'read' {
  if (state === 'read' && (readerOptedOut || viewerOptedOut)) return 'delivered';
  return state;
}

/** Sender-facing aggregate across recipients: sent < delivered < read. */
function aggregateFor(
  recipients: MemberWithUser[],
  statuses: Map<string, 'notified' | 'delivered' | 'read'>,
  viewerOptedOut: boolean,
): MessageAggregateState {
  if (recipients.length === 0) return 'read';
  let allRead = true;
  for (const recipient of recipients) {
    const raw = statuses.get(recipient.userId);
    if (!raw || raw === 'notified') return 'sent';
    const state = effectiveState(raw, !readReceiptsOn(recipient), viewerOptedOut);
    if (state !== 'read') allRead = false;
  }
  return allRead ? 'read' : 'delivered';
}

// ── Conversations ────────────────────────────────────────────────────────────

/** §15: every member must be an accepted, unblocked friend of the creator. */
async function assertCanChatWith(creatorId: string, userId: string): Promise<void> {
  if (userId === creatorId) {
    throw new AppError('VALIDATION_FAILED', 'You are already in this conversation');
  }
  const block = await social.findBlockBetween(creatorId, userId);
  if (block?.blockerId === userId) throw new AppError('NOT_FOUND', 'User not found');
  if (block) throw new AppError('CONFLICT', 'Unblock this user before messaging them');
  const friendship = await social.findFriendship(creatorId, userId);
  if (!friendship) {
    throw new AppError('FORBIDDEN', 'You can only start conversations with friends');
  }
}

export async function createConversation(
  creatorId: string,
  body: CreateConversationBody,
): Promise<{ conversation: ConversationDto; existing: boolean }> {
  const memberIds = body.members.map((m) => m.userId);
  if (new Set(memberIds).size !== memberIds.length) {
    throw new AppError('VALIDATION_FAILED', 'Duplicate members');
  }
  for (const userId of memberIds) {
    await assertCanChatWith(creatorId, userId);
  }

  if (body.type === 'direct') {
    const existing = await chat.findDirectBetween(creatorId, memberIds[0]!);
    if (existing) {
      const me = existing.members.find((m) => m.userId === creatorId);
      const lastMessage =
        (
          await chat.listMessages(existing.id, creatorId, {
            limit: 1,
            clearedAt: me?.clearedAt ?? null,
          })
        )[0] ?? null;
      return {
        conversation: await toConversationDto(creatorId, existing, lastMessage),
        existing: true,
      };
    }
  }

  const conversation = await chat.createConversation({
    type: body.type,
    name: body.name,
    creatorId,
    creatorWrappedKey: body.myWrappedKey,
    members: body.members,
  });
  logger.info(
    { event: 'chat.conversation_created', conversationId: conversation.id, type: body.type },
    'conversation created',
  );

  // Members learn about the new conversation live and refetch their list.
  const io = getIo();
  for (const userId of memberIds) {
    io?.to(`user:${userId}`).emit(SERVER_EVENTS.NOTIFICATION_NEW, {
      type: 'conversation_new',
      payload: { conversationId: conversation.id },
      createdAt: new Date().toISOString(),
    });
  }
  return { conversation: await toConversationDto(creatorId, conversation, null), existing: false };
}

export async function listConversations(viewerId: string): Promise<ConversationDto[]> {
  const rows = await chat.listConversationsFor(viewerId);
  rows.sort((a, b) => {
    const at = a.messages[0]?.createdAt ?? a.createdAt;
    const bt = b.messages[0]?.createdAt ?? b.createdAt;
    return bt.getTime() - at.getTime();
  });
  return Promise.all(rows.map((row) => toConversationDto(viewerId, row, row.messages[0] ?? null)));
}

export async function addMember(
  actorId: string,
  conversationId: string,
  input: { userId: string; wrappedKey: string },
): Promise<void> {
  const conversation = await chat.getConversation(conversationId);
  const actor = conversation?.members.find((m) => m.userId === actorId);
  if (!conversation || !actor) throw new AppError('NOT_FOUND', 'Conversation not found');
  if (conversation.type !== 'group') {
    throw new AppError('VALIDATION_FAILED', 'Members can only be added to groups');
  }
  if (actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only the group admin can add members');
  }
  if (conversation.members.some((m) => m.userId === input.userId)) {
    throw new AppError('CONFLICT', 'Already a member');
  }
  if (conversation.members.length >= 50) {
    throw new AppError('CONFLICT', 'This group is full');
  }
  await assertCanChatWith(actorId, input.userId);
  await chat.addMember({ conversationId, ...input });
  getIo()?.to(`user:${input.userId}`).emit(SERVER_EVENTS.NOTIFICATION_NEW, {
    type: 'conversation_new',
    payload: { conversationId },
    createdAt: new Date().toISOString(),
  });
  logger.info(
    { event: 'chat.member_added', conversationId, userId: input.userId, actorId },
    'group member added',
  );
}

/** Self-removal is leaving; removing someone else is admin-only. */
export async function removeMember(
  actorId: string,
  conversationId: string,
  targetUserId: string,
): Promise<void> {
  const conversation = await chat.getConversation(conversationId);
  const actor = conversation?.members.find((m) => m.userId === actorId);
  if (!conversation || !actor) throw new AppError('NOT_FOUND', 'Conversation not found');
  if (conversation.type !== 'group') {
    throw new AppError('VALIDATION_FAILED', 'Direct conversations have fixed members');
  }
  if (targetUserId !== actorId && actor.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only the group admin can remove members');
  }
  const removed = await chat.removeMember(conversationId, targetUserId);
  if (!removed) throw new AppError('NOT_FOUND', 'Not a member of this group');
  logger.info(
    { event: 'chat.member_removed', conversationId, targetUserId, actorId },
    'group member removed',
  );
}

// ── History ──────────────────────────────────────────────────────────────────

export async function getMessages(
  viewerId: string,
  conversationId: string,
  query: { cursor?: string; limit: number },
): Promise<Page<MessageDto>> {
  const conversation = await chat.getConversation(conversationId);
  const me = conversation?.members.find((m) => m.userId === viewerId);
  if (!conversation || !me) throw new AppError('NOT_FOUND', 'Conversation not found');

  const beforeSequence = query.cursor ? Number.parseInt(query.cursor, 10) : undefined;
  if (query.cursor && !Number.isFinite(beforeSequence)) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  }
  const rows = await chat.listMessages(conversationId, viewerId, {
    beforeSequence,
    limit: query.limit + 1,
    clearedAt: me.clearedAt,
  });
  const pageRows = rows.slice(0, query.limit);

  // Aggregate ticks for the viewer's own messages (§14.1).
  const ownIds = pageRows.filter((m) => m.senderId === viewerId).map((m) => m.id);
  const statusRows = await chat.statusesForMessages(ownIds);
  const byMessage = new Map<string, Map<string, 'notified' | 'delivered' | 'read'>>();
  for (const row of statusRows) {
    const inner = byMessage.get(row.messageId) ?? new Map();
    inner.set(row.userId, row.state);
    byMessage.set(row.messageId, inner);
  }
  const viewerOptedOut = !readReceiptsOn(me);
  const recipients = conversation.members.filter((m) => m.userId !== viewerId);

  return {
    items: pageRows.map((message) =>
      toMessageDto(
        message,
        message.senderId === viewerId
          ? aggregateFor(recipients, byMessage.get(message.id) ?? new Map(), viewerOptedOut)
          : undefined,
      ),
    ),
    ...(rows.length > query.limit ? { nextCursor: String(pageRows.at(-1)!.sequence) } : {}),
  };
}

/** Per-member breakdown (§14.2) — only the sender may see it. */
export async function statusBreakdown(
  viewerId: string,
  messageId: string,
): Promise<MessageStatusDto[]> {
  const found = await chat.findMessageById(messageId);
  if (!found) throw new AppError('NOT_FOUND', 'Message not found');
  if (found.senderId !== viewerId) {
    throw new AppError('FORBIDDEN', 'Only the sender can view delivery details');
  }
  const conversation = await chat.getConversation(found.conversationId);
  if (!conversation) throw new AppError('NOT_FOUND', 'Conversation not found');

  const statuses = await chat.statusesForMessage(messageId);
  const viewer = conversation.members.find((m) => m.userId === viewerId);
  const viewerOptedOut = !readReceiptsOn(viewer);
  const byUser = new Map(statuses.map((s) => [s.userId, s]));

  return conversation.members
    .filter((member) => member.userId !== viewerId)
    .map((member) => {
      const row = byUser.get(member.userId);
      return {
        user: toUserSummaryDto(member.user),
        state: row ? effectiveState(row.state, !readReceiptsOn(member), viewerOptedOut) : null,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
}

// ── Send / ack / sync (socket paths) ─────────────────────────────────────────

function isUniqueViolation(error: unknown, field: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002' &&
    JSON.stringify((error as { meta?: unknown }).meta ?? '').includes(field)
  );
}

export async function sendMessage(
  senderId: string,
  payload: MessageSendPayload,
): Promise<MessageDto> {
  const conversation = await chat.getConversation(payload.conversationId);
  const sender = conversation?.members.find((m) => m.userId === senderId);
  if (!conversation || !sender) throw new AppError('NOT_FOUND', 'Conversation not found');

  // §10.2: a block locks the direct conversation from both writers' sides.
  if (conversation.type === 'direct') {
    const other = conversation.members.find((m) => m.userId !== senderId);
    if (other) {
      const block = await social.findBlockBetween(senderId, other.userId);
      if (block) {
        throw new AppError(
          'FORBIDDEN',
          block.blockerId === senderId
            ? 'You blocked this user — unblock them to message'
            : 'You can no longer message this conversation',
        );
      }
    }
  }

  // Idempotency: a retried client_uuid returns the already-persisted row (§21.2).
  const existing = await chat.findByClientUuid(payload.conversationId, payload.clientUuid);
  if (existing) return toMessageDto(existing, 'sent');

  // §14.5 reply-to: the referenced message must live in this conversation.
  if (payload.replyToId) {
    const original = await chat.findMessageById(payload.replyToId);
    if (!original || original.conversationId !== payload.conversationId) {
      throw new AppError('VALIDATION_FAILED', 'Reply target is not in this conversation');
    }
  }
  // §14.5 forward: the source must be a message the sender can actually read.
  if (payload.forwardedFromId) {
    const source = await chat.findMessageById(payload.forwardedFromId);
    const membership = source ? await chat.getMembership(source.conversationId, senderId) : null;
    if (!source || !membership) {
      throw new AppError('VALIDATION_FAILED', 'Forward source is not available to you');
    }
  }

  let message: Message | null = null;
  for (let attempt = 0; attempt < SEQUENCE_RETRIES && !message; attempt += 1) {
    const sequence = (await chat.maxSequence(payload.conversationId)) + 1;
    try {
      message = await chat.createMessage({
        conversationId: payload.conversationId,
        senderId,
        ciphertext: payload.ciphertext,
        nonce: payload.nonce,
        sequence,
        clientUuid: payload.clientUuid,
        replyToId: payload.replyToId,
        forwardedFromId: payload.forwardedFromId,
      });
    } catch (error) {
      if (isUniqueViolation(error, 'client_uuid')) {
        const raced = await chat.findByClientUuid(payload.conversationId, payload.clientUuid);
        if (raced) return toMessageDto(raced, 'sent');
      }
      if (!isUniqueViolation(error, 'sequence')) throw error;
      // Sequence race — recompute and retry.
    }
  }
  if (!message) {
    throw new AppError('CONFLICT', 'Could not order the message — try again');
  }

  // Recipients with a live socket are "notified" immediately; the rest stay
  // unreached until they connect and sync (§14.2 "not yet notified").
  const recipients = conversation.members.filter((m) => m.userId !== senderId);
  const online = recipients.filter((m) => isOnline(m.userId)).map((m) => m.userId);
  await chat.markNotified(message.id, online);

  const dto = toMessageDto(message);
  const io = getIo();
  for (const member of conversation.members) {
    io?.to(`user:${member.userId}`).emit(SERVER_EVENTS.MESSAGE_NEW, dto);
  }
  logger.info(
    {
      event: 'chat.message_sent',
      conversationId: conversation.id,
      messageId: message.id,
      sequence: message.sequence,
      notified: online.length,
      recipients: recipients.length,
    },
    'message fanned out',
  );
  return toMessageDto(message, 'sent');
}

export async function ackMessages(userId: string, payload: MessageAckPayload): Promise<void> {
  const conversation = await chat.getConversation(payload.conversationId);
  const acker = conversation?.members.find((m) => m.userId === userId);
  if (!conversation || !acker) throw new AppError('NOT_FOUND', 'Conversation not found');

  await chat.ackUpTo(payload.conversationId, userId, payload.upToSequence, payload.state);

  // Live status update to the other members (§21.1) with the mutual
  // read-receipt rule applied per receiving member (§14.1).
  const io = getIo();
  if (!io) return;
  const ackerOptedOut = !readReceiptsOn(acker);
  for (const member of conversation.members) {
    if (member.userId === userId) continue;
    const state =
      payload.state === 'read' && (ackerOptedOut || !readReceiptsOn(member))
        ? 'delivered'
        : payload.state;
    const event: MessageStatusEventPayload = {
      conversationId: payload.conversationId,
      userId,
      upToSequence: payload.upToSequence,
      state,
    };
    io.to(`user:${member.userId}`).emit(SERVER_EVENTS.MESSAGE_STATUS, event);
  }
}

/**
 * Reconnect reconciliation (§21.2): replay everything after the client's last
 * known sequence per conversation, marking the replayed messages delivered.
 */
export async function syncMessages(
  userId: string,
  conversations: Array<{ conversationId: string; lastSequence: number }>,
): Promise<MessageDto[]> {
  const out: MessageDto[] = [];
  for (const { conversationId, lastSequence } of conversations) {
    const membership = await chat.getMembership(conversationId, userId);
    if (!membership) continue;
    const missed = await chat.listMessagesAfter(
      conversationId,
      userId,
      lastSequence,
      SYNC_CAP_PER_CONVERSATION,
    );
    if (missed.length === 0) continue;
    out.push(...missed.map((m) => toMessageDto(m)));
    const top = missed.at(-1)!.sequence;
    await ackMessages(userId, { conversationId, upToSequence: top, state: 'delivered' });
  }
  return out;
}

// ── Message actions (§14.3–14.6) ─────────────────────────────────────────────

/** Loads a message and asserts the caller is in its conversation. */
async function requireReadable(
  userId: string,
  messageId: string,
): Promise<{ message: Message; conversation: ConversationWithMembers }> {
  const message = await chat.findMessageById(messageId);
  const conversation = message ? await chat.getConversation(message.conversationId) : null;
  const membership = conversation?.members.find((m) => m.userId === userId);
  if (!message || !conversation || !membership) {
    throw new AppError('NOT_FOUND', 'Message not found');
  }
  return { message, conversation };
}

function fanOut(conversation: ConversationWithMembers, event: string, payload: unknown): void {
  const io = getIo();
  for (const member of conversation.members) {
    io?.to(`user:${member.userId}`).emit(event, payload);
  }
}

/** §14.3 edit — sender only, not on deleted messages, live to everyone. */
export async function editMessage(
  userId: string,
  messageId: string,
  content: { ciphertext: string; nonce: string },
): Promise<MessageDto> {
  const { message, conversation } = await requireReadable(userId, messageId);
  if (message.senderId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the sender can edit a message');
  }
  if (message.deletedForEveryoneAt) {
    throw new AppError('CONFLICT', 'This message was deleted');
  }
  const updated = await chat.updateMessageContent(messageId, content);
  const dto = toMessageDto(updated);
  fanOut(conversation, SERVER_EVENTS.MESSAGE_EDITED, dto);
  logger.info({ event: 'chat.message_edited', messageId, userId }, 'message edited');
  return dto;
}

/** §14.3 delete — "me" hides locally, "everyone" tombstones (sender only). */
export async function deleteMessage(
  userId: string,
  messageId: string,
  scope: 'me' | 'everyone',
): Promise<void> {
  const { message, conversation } = await requireReadable(userId, messageId);
  if (scope === 'me') {
    await chat.hideMessage(messageId, userId);
    return;
  }
  if (message.senderId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the sender can delete for everyone');
  }
  if (!message.deletedForEveryoneAt) {
    await chat.tombstoneMessage(messageId);
    fanOut(conversation, SERVER_EVENTS.MESSAGE_DELETED, {
      conversationId: conversation.id,
      messageId,
    });
  }
  logger.info({ event: 'chat.message_deleted', messageId, userId, scope }, 'message deleted');
}

/** §14.4 reaction toggle; the resulting state is broadcast to members. */
export async function reactToMessage(
  userId: string,
  messageId: string,
  emoji: string,
): Promise<{ emoji: string | null }> {
  const { message, conversation } = await requireReadable(userId, messageId);
  if (message.deletedForEveryoneAt) {
    throw new AppError('CONFLICT', 'This message was deleted');
  }
  const result = await chat.toggleReaction(messageId, userId, emoji);
  fanOut(conversation, SERVER_EVENTS.MESSAGE_REACTION, {
    conversationId: conversation.id,
    messageId,
    userId,
    emoji: result,
  });
  return { emoji: result };
}

/** §14.6 star toggle — private to the caller, no broadcast. */
export async function starMessage(
  userId: string,
  messageId: string,
): Promise<{ starred: boolean }> {
  await requireReadable(userId, messageId);
  return { starred: await chat.toggleStar(messageId, userId) };
}

/** §14.6 starred view, each entry labelled with its conversation context. */
export async function listStarredMessages(
  userId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<StarredMessageDto>> {
  const rows = await chat.listStarred(userId, {
    cursorMessageId: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map((star) => {
      const conversation = star.message.conversation;
      const other = conversation.members.find((m) => m.userId !== userId);
      return {
        message: toMessageDto(star.message),
        starredAt: star.createdAt.toISOString(),
        conversationLabel:
          conversation.type === 'group'
            ? (conversation.name ?? 'Group')
            : (other?.user.displayName ?? 'Conversation'),
      };
    }),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.messageId } : {}),
  };
}

/** §14.11 pin/mute/archive — per-member flags, no one else affected. */
export async function updateConversationSettings(
  userId: string,
  conversationId: string,
  settings: { pinned?: boolean; muted?: boolean; archived?: boolean },
): Promise<void> {
  const membership = await chat.getMembership(conversationId, userId);
  if (!membership) throw new AppError('NOT_FOUND', 'Conversation not found');
  await chat.updateMemberSettings(conversationId, userId, settings);
}
