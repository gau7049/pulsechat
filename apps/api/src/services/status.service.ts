import type { LiveSession, Status, StatusPoll, StatusPollResponse } from '@prisma/client';
import {
  LIMITS,
  type CreateStatusBody,
  type LiveActiveEntryDto,
  type LiveSessionDto,
  type ReactToStatusBody,
  type RespondToPollBody,
  type StatusDto,
  type StatusFeedEntryDto,
  type StatusPollDto,
  type StatusPollOptionDto,
  type StatusPollResultsDto,
} from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';
import * as liveRepo from '../repositories/live.repository.js';
import * as social from '../repositories/social.repository.js';
import * as statusRepo from '../repositories/status.repository.js';
import type { StatusWithMeta } from '../repositories/status.repository.js';
import * as users from '../repositories/user.repository.js';
import { notify } from './notification.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Status & live rail (Requirement Scope §11–12): ephemeral content scoped to
 * self + friends only — the same friend-gated model as the rest of the app.
 * Both list endpoints are unpaginated, bounded by friend count, matching the
 * trade-off already documented for `GET /conversations`. §24.12 adds a third
 * `close_friends` visibility tier on top of the existing everyone/friends
 * split; §24.10/§24.13 add reactions and poll/question stickers.
 */

const STATUS_TTL_MS = LIMITS.STATUS_TTL_HOURS * 60 * 60 * 1000;
const LIVE_STALE_MS = 6 * 60 * 60 * 1000;

let sweepHandle: NodeJS.Timeout | null = null;

// ── Serialization ────────────────────────────────────────────────────────────

function toPollDto(
  poll: StatusPoll & { responses: StatusPollResponse[] },
  viewerId: string,
): StatusPollDto {
  const mine = poll.responses.find((r) => r.userId === viewerId);
  return {
    id: poll.id,
    kind: poll.kind,
    question: poll.question,
    options: (poll.options as StatusPollOptionDto[] | null) ?? null,
    myResponse: mine
      ? { selectedOptionId: mine.selectedOptionId, answerText: mine.answerText }
      : null,
  };
}

export function toStatusDto(status: StatusWithMeta, viewerId: string): StatusDto {
  return {
    id: status.id,
    userId: status.userId,
    mediaUrl: status.mediaUrl,
    caption: status.caption,
    musicTrackId: status.musicTrackId,
    visibility: status.visibility,
    expiresAt: status.expiresAt.toISOString(),
    createdAt: status.createdAt.toISOString(),
    myReaction: status.reactions.find((r) => r.userId === viewerId)?.emoji ?? null,
    reactionCount: status.reactions.length,
    poll: status.poll ? toPollDto(status.poll, viewerId) : null,
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
    poll: body.poll,
  });
  logger.info({ event: 'status.created', userId, statusId: status.id }, 'status created');
  return toStatusDto(status, userId);
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

/**
 * §24.12 — a `close_friends`-visibility item is only shown to the author
 * (always) or to viewers on the author's close-friends list; every other
 * visibility level is unaffected by this check.
 */
function isVisible(
  authorId: string,
  visibility: string,
  viewerId: string,
  closeFriendOwners: Set<string>,
): boolean {
  return authorId === viewerId || visibility !== 'close_friends' || closeFriendOwners.has(authorId);
}

/** Single-item authorization shared by react/poll actions — friend + block + close-friends gated. */
async function assertCanViewStatus(viewerId: string, status: Status): Promise<void> {
  if (status.userId === viewerId) return;
  const block = await social.findBlockBetween(viewerId, status.userId);
  if (block) throw new AppError('NOT_FOUND', 'Status not found');
  const friendship = await social.findFriendship(viewerId, status.userId);
  if (!friendship) throw new AppError('NOT_FOUND', 'Status not found');
  if (status.visibility === 'close_friends') {
    const closeFriendIds = await social.closeFriendIds(status.userId);
    if (!closeFriendIds.includes(viewerId)) throw new AppError('NOT_FOUND', 'Status not found');
  }
}

/** §12.1 rail: one entry per user with active content, live-having users first. */
export async function getFeed(viewerId: string): Promise<StatusFeedEntryDto[]> {
  const candidateIds = await visibleCandidateIds(viewerId);
  const [statuses, liveSessions, people, closeFriendOwnerIds] = await Promise.all([
    statusRepo.findActiveForUsers(candidateIds),
    liveRepo.findActiveForUsers(candidateIds),
    users.findManyByIds(candidateIds),
    social.authorsWhoCloseFriended(viewerId, candidateIds),
  ]);
  const closeFriendOwners = new Set(closeFriendOwnerIds);

  const statusesByUser = new Map<string, StatusWithMeta[]>();
  for (const status of statuses) {
    if (!isVisible(status.userId, status.visibility, viewerId, closeFriendOwners)) continue;
    const list = statusesByUser.get(status.userId) ?? [];
    list.push(status);
    statusesByUser.set(status.userId, list);
  }
  const liveByUser = new Map(liveSessions.map((session) => [session.userId, session]));
  const peopleById = new Map(people.map((person) => [person.id, person]));

  const entries: StatusFeedEntryDto[] = [];
  for (const userId of candidateIds) {
    const userStatuses = statusesByUser.get(userId) ?? [];
    const liveSession = liveByUser.get(userId) ?? null;
    const live =
      liveSession && isVisible(userId, liveSession.visibility, viewerId, closeFriendOwners)
        ? liveSession
        : null;
    if (userStatuses.length === 0 && !live) continue;
    const person = peopleById.get(userId);
    if (!person) continue;
    entries.push({
      user: toUserSummaryDto(person),
      statuses: userStatuses.map((status) => toStatusDto(status, viewerId)),
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
  const [liveSessions, people, closeFriendOwnerIds] = await Promise.all([
    liveRepo.findActiveForUsers(candidateIds),
    users.findManyByIds(candidateIds),
    social.authorsWhoCloseFriended(viewerId, candidateIds),
  ]);
  const closeFriendOwners = new Set(closeFriendOwnerIds);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  return liveSessions.flatMap((session) => {
    if (!isVisible(session.userId, session.visibility, viewerId, closeFriendOwners)) return [];
    const person = peopleById.get(session.userId);
    return person ? [{ user: toUserSummaryDto(person), session: toLiveSessionDto(session) }] : [];
  });
}

// ── Reactions (§24.10) ───────────────────────────────────────────────────────

export async function reactToStatus(
  viewerId: string,
  statusId: string,
  body: ReactToStatusBody,
): Promise<{ emoji: string | null }> {
  const status = await statusRepo.findById(statusId);
  if (!status) throw new AppError('NOT_FOUND', 'Status not found');
  await assertCanViewStatus(viewerId, status);
  const emoji = await statusRepo.toggleReaction(statusId, viewerId, body.emoji);
  if (emoji && status.userId !== viewerId) {
    const reactor = await users.findById(viewerId);
    if (reactor) {
      await notify(status.userId, 'story_reaction', {
        from: toUserSummaryDto(reactor),
        statusId,
        emoji,
      });
    }
  }
  return { emoji };
}

// ── Polls/questions (§24.13) ─────────────────────────────────────────────────

export async function respondToPoll(
  viewerId: string,
  statusId: string,
  body: RespondToPollBody,
): Promise<void> {
  const status = await statusRepo.findById(statusId);
  if (!status) throw new AppError('NOT_FOUND', 'Status not found');
  await assertCanViewStatus(viewerId, status);
  const poll = await statusRepo.findPollByStatusId(statusId);
  if (!poll) throw new AppError('NOT_FOUND', 'This status has no poll or question');

  if (poll.kind === 'poll') {
    const options = (poll.options as StatusPollOptionDto[] | null) ?? [];
    if (!body.selectedOptionId || !options.some((o) => o.id === body.selectedOptionId)) {
      throw new AppError('VALIDATION_FAILED', 'Choose one of the poll options');
    }
    await statusRepo.upsertPollResponse(poll.id, viewerId, {
      selectedOptionId: body.selectedOptionId,
      answerText: null,
    });
  } else {
    if (!body.answerText) {
      throw new AppError('VALIDATION_FAILED', 'Write an answer to respond');
    }
    await statusRepo.upsertPollResponse(poll.id, viewerId, {
      selectedOptionId: null,
      answerText: body.answerText,
    });
  }

  if (status.userId !== viewerId) {
    const responder = await users.findById(viewerId);
    if (responder) {
      await notify(status.userId, 'story_poll_response', {
        from: toUserSummaryDto(responder),
        statusId,
      });
    }
  }
}

/** Author-only aggregate — poll tallies or raw question answers, never per-viewer. */
export async function getPollResults(
  viewerId: string,
  statusId: string,
): Promise<StatusPollResultsDto> {
  const status = await statusRepo.findById(statusId);
  if (!status) throw new AppError('NOT_FOUND', 'Status not found');
  if (status.userId !== viewerId) {
    throw new AppError('FORBIDDEN', 'Only the author can view poll results');
  }
  const poll = await statusRepo.findPollByStatusId(statusId);
  if (!poll) throw new AppError('NOT_FOUND', 'This status has no poll or question');
  const withResponses = await statusRepo.findPollWithResponses(poll.id);
  const responses = withResponses?.responses ?? [];

  if (poll.kind === 'question') {
    return {
      kind: 'question',
      answers: responses
        .filter((r) => r.answerText)
        .map((r) => ({
          user: toUserSummaryDto(r.user),
          answerText: r.answerText!,
          createdAt: r.createdAt.toISOString(),
        })),
    };
  }

  const options = (poll.options as StatusPollOptionDto[] | null) ?? [];
  const counts = new Map<string, number>();
  for (const response of responses) {
    if (!response.selectedOptionId) continue;
    counts.set(response.selectedOptionId, (counts.get(response.selectedOptionId) ?? 0) + 1);
  }
  return {
    kind: 'poll',
    totalResponses: responses.length,
    options: options.map((option) => ({ ...option, count: counts.get(option.id) ?? 0 })),
  };
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
