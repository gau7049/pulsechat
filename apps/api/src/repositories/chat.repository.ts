import type {
  Conversation,
  ConversationMember,
  Message,
  MessageStatus,
  PrivacySetting,
  User,
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for conversations, messages, and per-recipient delivery state.
 * Sequence assignment and idempotency rules live in the chat service; this
 * layer only shapes queries (Build Instructions §6 layering).
 *
 * Members always load with user + privacy: read receipts and last-seen
 * visibility decisions need them on every path.
 */

export type MemberWithUser = ConversationMember & {
  user: User & { privacy: PrivacySetting | null };
};
export type ConversationWithMembers = Conversation & { members: MemberWithUser[] };
export type ConversationForList = ConversationWithMembers & { messages: Message[] };

// ── Conversations & membership ───────────────────────────────────────────────

export function createConversation(input: {
  type: 'direct' | 'group';
  name?: string;
  creatorId: string;
  creatorWrappedKey: string;
  members: Array<{ userId: string; wrappedKey: string }>;
}): Promise<ConversationWithMembers> {
  return prisma.conversation.create({
    data: {
      type: input.type,
      name: input.name ?? null,
      members: {
        create: [
          { userId: input.creatorId, role: 'admin', wrappedKey: input.creatorWrappedKey },
          ...input.members.map((m) => ({ userId: m.userId, wrappedKey: m.wrappedKey })),
        ],
      },
    },
    include: { members: { include: { user: { include: { privacy: true } } } } },
  });
}

/** The existing direct conversation between two users, if one exists. */
export async function findDirectBetween(
  a: string,
  b: string,
): Promise<ConversationWithMembers | null> {
  return prisma.conversation.findFirst({
    where: {
      type: 'direct',
      AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }],
    },
    include: { members: { include: { user: { include: { privacy: true } } } } },
  });
}

export function getMembership(
  conversationId: string,
  userId: string,
): Promise<ConversationMember | null> {
  return prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
}

export function getConversation(id: string): Promise<ConversationWithMembers | null> {
  return prisma.conversation.findUnique({
    where: { id },
    include: { members: { include: { user: { include: { privacy: true } } } } },
  });
}

export async function memberIds(conversationId: string): Promise<string[]> {
  const rows = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Every conversation the user belongs to, each carrying its latest message.
 * Capped, then ordered by last activity in the service — at product scale a
 * user's conversation list fits one page (documented §14 trade-off).
 */
export function listConversationsFor(userId: string): Promise<ConversationForList[]> {
  return prisma.conversation.findMany({
    where: { members: { some: { userId } } },
    include: {
      members: { include: { user: { include: { privacy: true } } } },
      messages: { orderBy: { sequence: 'desc' }, take: 1 },
    },
    take: 100,
  });
}

export function addMember(input: {
  conversationId: string;
  userId: string;
  wrappedKey: string;
}): Promise<MemberWithUser> {
  return prisma.conversationMember.create({
    data: input,
    include: { user: { include: { privacy: true } } },
  });
}

export async function removeMember(conversationId: string, userId: string): Promise<boolean> {
  const result = await prisma.conversationMember.deleteMany({
    where: { conversationId, userId },
  });
  return result.count > 0;
}

// ── Messages ─────────────────────────────────────────────────────────────────

export function maxSequence(conversationId: string): Promise<number> {
  return prisma.message
    .aggregate({ where: { conversationId }, _max: { sequence: true } })
    .then((r) => r._max.sequence ?? 0);
}

export function createMessage(input: {
  conversationId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  sequence: number;
  clientUuid: string;
}): Promise<Message> {
  return prisma.message.create({ data: input });
}

export function findMessageById(id: string): Promise<Message | null> {
  return prisma.message.findUnique({ where: { id } });
}

export function findByClientUuid(
  conversationId: string,
  clientUuid: string,
): Promise<Message | null> {
  return prisma.message.findUnique({
    where: { conversationId_clientUuid: { conversationId, clientUuid } },
  });
}

/** One history page, newest first, strictly below the cursor sequence. */
export function listMessages(
  conversationId: string,
  options: { beforeSequence?: number; limit: number },
): Promise<Message[]> {
  return prisma.message.findMany({
    where: {
      conversationId,
      ...(options.beforeSequence !== undefined ? { sequence: { lt: options.beforeSequence } } : {}),
    },
    orderBy: { sequence: 'desc' },
    take: options.limit,
  });
}

/** Gap replay: everything after the client's last known sequence (§21.2). */
export function listMessagesAfter(
  conversationId: string,
  afterSequence: number,
  cap: number,
): Promise<Message[]> {
  return prisma.message.findMany({
    where: { conversationId, sequence: { gt: afterSequence } },
    orderBy: { sequence: 'asc' },
    take: cap,
  });
}

/** Messages from others without a read receipt from this user (§14.1 badge). */
export function countUnread(
  conversationId: string,
  userId: string,
  clearedAt: Date | null,
): Promise<number> {
  return prisma.message.count({
    where: {
      conversationId,
      senderId: { not: userId },
      ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
      statuses: { none: { userId, state: 'read' } },
    },
  });
}

// ── Delivery statuses ────────────────────────────────────────────────────────

/** First contact: rows for recipients whose device the fan-out reached. */
export async function markNotified(messageId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await prisma.messageStatus.createMany({
    data: userIds.map((userId) => ({ messageId, userId, state: 'notified' as const })),
    skipDuplicates: true,
  });
}

/**
 * Acknowledge every message from others up to a sequence, monotonically:
 * a read never downgrades, a delivery never overwrites a read (§21.1).
 */
export async function ackUpTo(
  conversationId: string,
  userId: string,
  upToSequence: number,
  state: 'delivered' | 'read',
): Promise<void> {
  const messages = await prisma.message.findMany({
    where: { conversationId, sequence: { lte: upToSequence }, senderId: { not: userId } },
    select: { id: true },
    orderBy: { sequence: 'desc' },
    // Acks are cumulative, so bounding the scan keeps huge backlogs cheap.
    take: 500,
  });
  const ids = messages.map((m) => m.id);
  if (ids.length === 0) return;

  await prisma.$transaction([
    prisma.messageStatus.createMany({
      data: ids.map((messageId) => ({ messageId, userId, state })),
      skipDuplicates: true,
    }),
    prisma.messageStatus.updateMany({
      where: {
        messageId: { in: ids },
        userId,
        state: state === 'read' ? { in: ['notified', 'delivered'] } : 'notified',
      },
      data: { state },
    }),
  ]);
}

export function statusesForMessage(messageId: string): Promise<MessageStatus[]> {
  return prisma.messageStatus.findMany({ where: { messageId } });
}

export function statusesForMessages(messageIds: string[]): Promise<MessageStatus[]> {
  if (messageIds.length === 0) return Promise.resolve([]);
  return prisma.messageStatus.findMany({ where: { messageId: { in: messageIds } } });
}
