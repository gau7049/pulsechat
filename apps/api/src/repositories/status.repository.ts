import type { Status } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for ephemeral 24h statuses (Requirement Scope §11). Visibility
 * gating and expiry-window decisions live in the service layer; this layer
 * only shapes queries (Build Instructions §6 layering).
 */

export function create(input: {
  userId: string;
  mediaUrl?: string;
  caption?: string;
  musicTrackId?: string;
  visibility: 'everyone' | 'friends';
  expiresAt: Date;
}): Promise<Status> {
  return prisma.status.create({
    data: {
      userId: input.userId,
      mediaUrl: input.mediaUrl ?? null,
      caption: input.caption ?? null,
      musicTrackId: input.musicTrackId ?? null,
      visibility: input.visibility,
      expiresAt: input.expiresAt,
    },
  });
}

export function findById(id: string): Promise<Status | null> {
  return prisma.status.findUnique({ where: { id } });
}

export async function deleteById(id: string): Promise<void> {
  await prisma.status.delete({ where: { id } });
}

/** Active (unexpired) statuses across a set of users, oldest first per user (rail order). */
export function findActiveForUsers(userIds: string[]): Promise<Status[]> {
  if (userIds.length === 0) return Promise.resolve([]);
  return prisma.status.findMany({
    where: { userId: { in: userIds }, expiresAt: { gt: new Date() } },
    orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
  });
}

/** Storage hygiene sweep (Technical Spec §4 "swept by a cron job"). */
export async function sweepExpired(): Promise<number> {
  const result = await prisma.status.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return result.count;
}
