import type {
  Conversation,
  ConversationMember,
  Message,
  MessageReaction,
  MessageStar,
  MessageStatus,
  Prisma,
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
      createdById: input.creatorId,
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

/** Group photo update (admin-or-creator gated by the service). */
export function updateGroupPhoto(
  conversationId: string,
  photoUrl: string,
): Promise<ConversationWithMembers> {
  return prisma.conversation.update({
    where: { id: conversationId },
    data: { photoUrl },
    include: { members: { include: { user: { include: { privacy: true } } } } },
  });
}

/** Atomically flip the admin role from one member to another. */
export async function transferAdminRole(
  conversationId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: fromUserId } },
      data: { role: 'member' },
    }),
    prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId: toUserId } },
      data: { role: 'admin' },
    }),
  ]);
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

/** A message plus per-viewer metadata: everyone's reactions, the viewer's star. */
export type MessageWithMeta = Message & {
  reactions: MessageReaction[];
  stars: MessageStar[];
};

const metaInclude = (viewerId: string) => ({
  reactions: true,
  stars: { where: { userId: viewerId } },
});

/** Per-viewer visibility (§14.3): hides + the "clear chat" horizon. */
function visibleTo(viewerId: string, clearedAt: Date | null): Prisma.MessageWhereInput {
  return {
    hides: { none: { userId: viewerId } },
    ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
  };
}

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
  replyToId?: string;
  forwardedFromId?: string;
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

/** One history page for a viewer, newest first, below the cursor sequence. */
export function listMessages(
  conversationId: string,
  viewerId: string,
  options: { beforeSequence?: number; limit: number; clearedAt?: Date | null },
): Promise<MessageWithMeta[]> {
  return prisma.message.findMany({
    where: {
      conversationId,
      ...(options.beforeSequence !== undefined ? { sequence: { lt: options.beforeSequence } } : {}),
      ...visibleTo(viewerId, options.clearedAt ?? null),
    },
    include: metaInclude(viewerId),
    orderBy: { sequence: 'desc' },
    take: options.limit,
  });
}

/** Gap replay: everything after the client's last known sequence (§21.2). */
export function listMessagesAfter(
  conversationId: string,
  viewerId: string,
  afterSequence: number,
  cap: number,
): Promise<MessageWithMeta[]> {
  return prisma.message.findMany({
    where: {
      conversationId,
      sequence: { gt: afterSequence },
      ...visibleTo(viewerId, null),
    },
    include: metaInclude(viewerId),
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
      statuses: { none: { userId, state: 'read' } },
      ...visibleTo(userId, clearedAt),
    },
  });
}

// ── Message actions (§14.3–14.6) ─────────────────────────────────────────────

/** Edit: replace ciphertext in place and stamp editedAt (§14.3). */
export function updateMessageContent(
  id: string,
  content: { ciphertext: string; nonce: string },
): Promise<Message> {
  return prisma.message.update({
    where: { id },
    data: { ...content, editedAt: new Date() },
  });
}

/**
 * Delete for everyone: tombstone the row and drop the ciphertext (§14.3).
 * `deletedBy` is set only for a group admin's removal of someone else's
 * message — left undefined for the sender's own delete.
 */
export function tombstoneMessage(id: string, deletedBy?: string): Promise<Message> {
  return prisma.message.update({
    where: { id },
    data: {
      deletedForEveryoneAt: new Date(),
      ciphertext: '',
      nonce: '',
      ...(deletedBy ? { deletedBy } : {}),
    },
  });
}

/** Delete for me: per-viewer hide row; idempotent (§14.3). */
export async function hideMessage(messageId: string, userId: string): Promise<void> {
  await prisma.messageHide.createMany({
    data: [{ messageId, userId }],
    skipDuplicates: true,
  });
}

/** Toggle semantics (§14.4): same emoji removes, different emoji replaces. */
export async function toggleReaction(
  messageId: string,
  userId: string,
  emoji: string,
): Promise<string | null> {
  const existing = await prisma.messageReaction.findUnique({
    where: { messageId_userId: { messageId, userId } },
  });
  if (existing?.emoji === emoji) {
    await prisma.messageReaction.delete({ where: { messageId_userId: { messageId, userId } } });
    return null;
  }
  await prisma.messageReaction.upsert({
    where: { messageId_userId: { messageId, userId } },
    create: { messageId, userId, emoji },
    update: { emoji },
  });
  return emoji;
}

/** Star toggle (§14.6); returns the new state. */
export async function toggleStar(messageId: string, userId: string): Promise<boolean> {
  const existing = await prisma.messageStar.findUnique({
    where: { messageId_userId: { messageId, userId } },
  });
  if (existing) {
    await prisma.messageStar.delete({ where: { messageId_userId: { messageId, userId } } });
    return false;
  }
  await prisma.messageStar.create({ data: { messageId, userId } });
  return true;
}

export type StarWithMessage = MessageStar & {
  message: MessageWithMeta & {
    conversation: Conversation & { members: MemberWithUser[] };
  };
};

/** The viewer's starred messages, newest star first (§14.6). */
export function listStarred(
  userId: string,
  options: { cursorMessageId?: string; limit: number },
): Promise<StarWithMessage[]> {
  return prisma.messageStar.findMany({
    where: { userId, message: { hides: { none: { userId } } } },
    include: {
      message: {
        include: {
          ...metaInclude(userId),
          conversation: {
            include: { members: { include: { user: { include: { privacy: true } } } } },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { messageId: 'asc' }],
    take: options.limit,
    ...(options.cursorMessageId
      ? { cursor: { messageId_userId: { messageId: options.cursorMessageId, userId } }, skip: 1 }
      : {}),
  });
}

/** §14.11 pin/mute/archive — flags live on the member row. */
export function updateMemberSettings(
  conversationId: string,
  userId: string,
  settings: { pinned?: boolean; muted?: boolean; archived?: boolean },
): Promise<ConversationMember> {
  return prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: settings,
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
