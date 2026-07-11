import { SERVER_EVENTS, type PresenceUpdatePayload } from '@pulsechat/shared';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import * as social from '../repositories/social.repository.js';

/**
 * Online/offline + last-seen tracking (Requirement Scope §21.1). Live state is
 * an in-process map (single Node process, Technical Spec §2); durable
 * last-seen rides on Device.lastSeenAt, refreshed by presence heartbeats.
 */

const sockets = new Map<string, Set<string>>();

export function isOnline(userId: string): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0;
}

/** Latest device activity per user — the §8 "last seen" source. */
export async function lastSeenFor(userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.device.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _max: { lastSeenAt: true },
  });
  return new Map(
    rows.flatMap((r) => (r._max.lastSeenAt ? [[r.userId, r._max.lastSeenAt] as const] : [])),
  );
}

export async function heartbeat(deviceId: string): Promise<void> {
  try {
    await prisma.device.update({ where: { id: deviceId }, data: { lastSeenAt: new Date() } });
  } catch {
    // A revoked/deleted device row is not worth failing the socket over.
  }
}

/**
 * What `viewer` may see of `target`'s presence (§8 Everyone/Friends/No One).
 * Friendship is checked lazily and only when the setting demands it.
 */
export async function visiblePresence(
  viewerId: string,
  target: { id: string; lastSeenVisibility: 'everyone' | 'friends' | 'no_one' },
  lastSeen: Date | null,
): Promise<{ online: boolean; lastSeenAt: string | null }> {
  if (target.id === viewerId) {
    return { online: true, lastSeenAt: lastSeen?.toISOString() ?? null };
  }
  if (target.lastSeenVisibility === 'no_one') return { online: false, lastSeenAt: null };
  if (target.lastSeenVisibility === 'friends') {
    const friendship = await social.findFriendship(viewerId, target.id);
    if (!friendship) return { online: false, lastSeenAt: null };
  }
  return { online: isOnline(target.id), lastSeenAt: lastSeen?.toISOString() ?? null };
}

/** Registers a socket; returns true when this is the user's first live socket. */
export function socketConnected(userId: string, socketId: string): boolean {
  const set = sockets.get(userId) ?? new Set<string>();
  const wasOffline = set.size === 0;
  set.add(socketId);
  sockets.set(userId, set);
  return wasOffline;
}

/** Deregisters a socket; returns true when the user just went fully offline. */
export function socketDisconnected(userId: string, socketId: string): boolean {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    sockets.delete(userId);
    return true;
  }
  return false;
}

/**
 * Fans a presence flip out to the user's friends, honouring their last-seen
 * visibility (§21.1: presence filtered per viewer's rights — friends are the
 * only viewers with presence UI, so `friends` and `everyone` behave alike here).
 */
export async function broadcastPresence(userId: string, online: boolean): Promise<void> {
  try {
    const io = getIo();
    if (!io) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { privacy: true },
    });
    if (!user || (user.privacy?.lastSeenVisibility ?? 'everyone') === 'no_one') return;

    const payload: PresenceUpdatePayload = {
      userId,
      online,
      lastSeenAt: online ? null : new Date().toISOString(),
    };
    const friends = await social.friendIds(userId);
    for (const friendId of friends) {
      io.to(`user:${friendId}`).emit(SERVER_EVENTS.PRESENCE_UPDATE, payload);
    }
    logger.debug({ event: 'presence.broadcast', userId, online }, 'presence update');
  } catch (error) {
    // Fire-and-forget from connect/disconnect paths — never let it throw
    // unhandled (e.g. racing a server shutdown).
    logger.warn({ event: 'presence.broadcast_failed', userId, err: error }, 'presence failed');
  }
}
