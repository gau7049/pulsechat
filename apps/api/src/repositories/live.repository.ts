import type { LiveSession } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for ephemeral live broadcasts (Requirement Scope §12). A row
 * exists only while a broadcast is active/just ended (Technical Spec §4);
 * one active session per user at a time.
 */

export async function start(
  userId: string,
  visibility: 'everyone' | 'friends',
): Promise<LiveSession> {
  return prisma.$transaction(async (tx) => {
    await tx.liveSession.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: new Date() },
    });
    return tx.liveSession.create({ data: { userId, visibility } });
  });
}

export async function end(userId: string): Promise<boolean> {
  const result = await prisma.liveSession.updateMany({
    where: { userId, endedAt: null },
    data: { endedAt: new Date() },
  });
  return result.count > 0;
}

export function findActiveForUser(userId: string): Promise<LiveSession | null> {
  return prisma.liveSession.findFirst({ where: { userId, endedAt: null } });
}

export function findActiveForUsers(userIds: string[]): Promise<LiveSession[]> {
  if (userIds.length === 0) return Promise.resolve([]);
  return prisma.liveSession.findMany({ where: { userId: { in: userIds }, endedAt: null } });
}

/** Crash backstop: end sessions abandoned past a staleness window. */
export async function endStale(olderThan: Date): Promise<number> {
  const result = await prisma.liveSession.updateMany({
    where: { endedAt: null, startedAt: { lt: olderThan } },
    data: { endedAt: new Date() },
  });
  return result.count;
}
