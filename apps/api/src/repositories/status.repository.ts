import type {
  Status,
  StatusPoll,
  StatusPollKind,
  StatusPollResponse,
  StatusReaction,
  StatusVisibility,
  User,
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for ephemeral 24h statuses (Requirement Scope §11). Visibility
 * gating and expiry-window decisions live in the service layer; this layer
 * only shapes queries (Build Instructions §6 layering).
 */

const statusInclude = {
  reactions: true,
  poll: { include: { responses: true } },
} as const;

export type StatusWithMeta = Status & {
  reactions: StatusReaction[];
  poll: (StatusPoll & { responses: StatusPollResponse[] }) | null;
};

export interface PollInput {
  kind: StatusPollKind;
  question: string;
  options?: Array<{ id: string; label: string }>;
}

/** §24.13 — the status and its optional poll/question sticker, created together. */
export async function create(input: {
  userId: string;
  mediaUrl?: string;
  caption?: string;
  musicTrackId?: string;
  visibility: StatusVisibility;
  expiresAt: Date;
  poll?: PollInput;
}): Promise<StatusWithMeta> {
  return prisma.$transaction(async (tx) => {
    const status = await tx.status.create({
      data: {
        userId: input.userId,
        mediaUrl: input.mediaUrl ?? null,
        caption: input.caption ?? null,
        musicTrackId: input.musicTrackId ?? null,
        visibility: input.visibility,
        expiresAt: input.expiresAt,
      },
    });
    if (input.poll) {
      await tx.statusPoll.create({
        data: {
          statusId: status.id,
          kind: input.poll.kind,
          question: input.poll.question,
          options: input.poll.options ?? undefined,
        },
      });
    }
    return tx.status.findUniqueOrThrow({ where: { id: status.id }, include: statusInclude });
  });
}

export function findById(id: string): Promise<StatusWithMeta | null> {
  return prisma.status.findUnique({ where: { id }, include: statusInclude });
}

export async function deleteById(id: string): Promise<void> {
  await prisma.status.delete({ where: { id } });
}

/** Active (unexpired) statuses across a set of users, oldest first per user (rail order). */
export function findActiveForUsers(userIds: string[]): Promise<StatusWithMeta[]> {
  if (userIds.length === 0) return Promise.resolve([]);
  return prisma.status.findMany({
    where: { userId: { in: userIds }, expiresAt: { gt: new Date() } },
    orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
    include: statusInclude,
  });
}

/** Storage hygiene sweep (Technical Spec §4 "swept by a cron job"). */
export async function sweepExpired(): Promise<number> {
  const result = await prisma.status.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}

// ── Reactions (§24.10) ───────────────────────────────────────────────────────

/** Toggle/replace, same semantics as `chat.repository.ts`'s message reactions. */
export async function toggleReaction(
  statusId: string,
  userId: string,
  emoji: string,
): Promise<string | null> {
  const existing = await prisma.statusReaction.findUnique({
    where: { statusId_userId: { statusId, userId } },
  });
  if (existing?.emoji === emoji) {
    await prisma.statusReaction.delete({ where: { statusId_userId: { statusId, userId } } });
    return null;
  }
  await prisma.statusReaction.upsert({
    where: { statusId_userId: { statusId, userId } },
    create: { statusId, userId, emoji },
    update: { emoji },
  });
  return emoji;
}

// ── Polls/questions (§24.13) ─────────────────────────────────────────────────

export function findPollByStatusId(statusId: string): Promise<StatusPoll | null> {
  return prisma.statusPoll.findUnique({ where: { statusId } });
}

export type PollResponseWithUser = StatusPollResponse & { user: User };

export function findPollWithResponses(
  pollId: string,
): Promise<(StatusPoll & { responses: PollResponseWithUser[] }) | null> {
  return prisma.statusPoll.findUnique({
    where: { id: pollId },
    include: { responses: { include: { user: true } } },
  });
}

export function upsertPollResponse(
  pollId: string,
  userId: string,
  data: { selectedOptionId: string | null; answerText: string | null },
): Promise<StatusPollResponse> {
  return prisma.statusPollResponse.upsert({
    where: { pollId_userId: { pollId, userId } },
    create: { pollId, userId, ...data },
    update: data,
  });
}
