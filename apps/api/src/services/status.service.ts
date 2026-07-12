import type { LiveSession, Status } from '@prisma/client';
import {
  LIMITS,
  type CreateStatusBody,
  type LiveActiveEntryDto,
  type LiveSessionDto,
  type StatusDto,
  type StatusFeedEntryDto,
} from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';
import * as liveRepo from '../repositories/live.repository.js';
import * as social from '../repositories/social.repository.js';
import * as statusRepo from '../repositories/status.repository.js';
import * as users from '../repositories/user.repository.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Status & live rail (Requirement Scope §11–12): ephemeral content scoped to
 * self + friends only — the same friend-gated model as the rest of the app.
 * Both list endpoints are unpaginated, bounded by friend count, matching the
 * trade-off already documented for `GET /conversations`.
 */

const STATUS_TTL_MS = LIMITS.STATUS_TTL_HOURS * 60 * 60 * 1000;
const LIVE_STALE_MS = 6 * 60 * 60 * 1000;

let sweepHandle: NodeJS.Timeout | null = null;

// ── Serialization ────────────────────────────────────────────────────────────

export function toStatusDto(status: Status): StatusDto {
  return {
    id: status.id,
    userId: status.userId,
    mediaUrl: status.mediaUrl,
    caption: status.caption,
    musicTrackId: status.musicTrackId,
    visibility: status.visibility,
    expiresAt: status.expiresAt.toISOString(),
    createdAt: status.createdAt.toISOString(),
  };
}

export function toLiveSessionDto(session: LiveSession): LiveSessionDto {
  return {
    id: session.id,
    userId: session.userId,
    visibility: session.visibility,
    startedAt: session.startedAt.toISOString(),
  };
}

// ── Statuses ─────────────────────────────────────────────────────────────────

export async function createStatus(userId: string, body: CreateStatusBody): Promise<StatusDto> {
  const status = await statusRepo.create({
    userId,
    mediaUrl: body.mediaUrl,
    caption: body.caption,
    musicTrackId: body.musicTrackId,
    visibility: body.visibility,
    expiresAt: new Date(Date.now() + STATUS_TTL_MS),
  });
  logger.info({ event: 'status.created', userId, statusId: status.id }, 'status created');
  return toStatusDto(status);
}

export async function deleteStatus(userId: string, statusId: string): Promise<void> {
  const status = await statusRepo.findById(statusId);
  if (!status) throw new AppError('NOT_FOUND', 'Status not found');
  if (status.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the author can delete a status');
  }
  await statusRepo.deleteById(statusId);
  logger.info({ event: 'status.deleted', userId, statusId }, 'status deleted');
}

/** Self + friends, excluding either-way blocks (§10.2 applies here too). */
async function visibleCandidateIds(viewerId: string): Promise<string[]> {
  const [friendIds, blockedIds] = await Promise.all([
    social.friendIds(viewerId),
    social.blockedEitherWayIds(viewerId),
  ]);
  const blocked = new Set(blockedIds);
  return [viewerId, ...friendIds.filter((id) => !blocked.has(id))];
}

/** §12.1 rail: one entry per user with active content, live-having users first. */
export async function getFeed(viewerId: string): Promise<StatusFeedEntryDto[]> {
  const candidateIds = await visibleCandidateIds(viewerId);
  const [statuses, liveSessions, people] = await Promise.all([
    statusRepo.findActiveForUsers(candidateIds),
    liveRepo.findActiveForUsers(candidateIds),
    users.findManyByIds(candidateIds),
  ]);

  const statusesByUser = new Map<string, Status[]>();
  for (const status of statuses) {
    const list = statusesByUser.get(status.userId) ?? [];
    list.push(status);
    statusesByUser.set(status.userId, list);
  }
  const liveByUser = new Map(liveSessions.map((session) => [session.userId, session]));
  const peopleById = new Map(people.map((person) => [person.id, person]));

  const entries: StatusFeedEntryDto[] = [];
  for (const userId of candidateIds) {
    const userStatuses = statusesByUser.get(userId) ?? [];
    const live = liveByUser.get(userId) ?? null;
    if (userStatuses.length === 0 && !live) continue;
    const person = peopleById.get(userId);
    if (!person) continue;
    entries.push({
      user: toUserSummaryDto(person),
      statuses: userStatuses.map(toStatusDto),
      live: live ? toLiveSessionDto(live) : null,
    });
  }

  // §12.1: users currently live sort ahead of status-only users.
  entries.sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)));
  return entries;
}

/** GET /live/active — friends + self who are currently broadcasting. */
export async function listActiveLive(viewerId: string): Promise<LiveActiveEntryDto[]> {
  const candidateIds = await visibleCandidateIds(viewerId);
  const [liveSessions, people] = await Promise.all([
    liveRepo.findActiveForUsers(candidateIds),
    users.findManyByIds(candidateIds),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return liveSessions.flatMap((session) => {
    const person = peopleById.get(session.userId);
    return person ? [{ user: toUserSummaryDto(person), session: toLiveSessionDto(session) }] : [];
  });
}

/** §11 expiry sweep + a live-session crash backstop; started once at boot. */
export function startExpirySweep(): void {
  if (sweepHandle) return;
  sweepHandle = setInterval(() => {
    statusRepo.sweepExpired().catch((error: unknown) => {
      logger.error({ event: 'status.sweep_failed', err: error }, 'status sweep failed');
    });
    liveRepo.endStale(new Date(Date.now() - LIVE_STALE_MS)).catch((error: unknown) => {
      logger.error({ event: 'live.sweep_failed', err: error }, 'live sweep failed');
    });
  }, LIMITS.STATUS_EXPIRY_SWEEP_INTERVAL_MS);
  sweepHandle.unref();
}
