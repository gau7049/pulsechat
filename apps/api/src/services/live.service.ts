import { SERVER_EVENTS, type LiveSessionDto, type StartLiveBody } from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import * as liveRepo from '../repositories/live.repository.js';
import * as social from '../repositories/social.repository.js';
import * as users from '../repositories/user.repository.js';
import { toLiveSessionDto } from './status.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Live broadcast lifecycle (Requirement Scope §12): persist-then-push, same
 * shape as `notification.service.ts` — the DB row is the source of truth,
 * the socket only carries the live notification of a state that already
 * exists (Technical Spec §2).
 */

export async function startLive(userId: string, body: StartLiveBody): Promise<LiveSessionDto> {
  const session = await liveRepo.start(userId, body.visibility);
  const dto = toLiveSessionDto(session);
  logger.info({ event: 'live.started', userId, sessionId: session.id }, 'live started');

  const io = getIo();
  if (io) {
    const broadcaster = await users.findById(userId);
    if (broadcaster) {
      const payload = { user: toUserSummaryDto(broadcaster), live: dto };
      for (const friendId of await social.friendIds(userId)) {
        io.to(`user:${friendId}`).emit(SERVER_EVENTS.LIVE_STARTED, payload);
      }
    }
  }
  return dto;
}

export async function endLive(userId: string): Promise<void> {
  const ended = await liveRepo.end(userId);
  if (!ended) throw new AppError('NOT_FOUND', 'No active live session');
  await fanOutEnded(userId);
}

/** Used by the socket disconnect path so an abandoned broadcast ends immediately. */
export async function endLiveIfActive(userId: string): Promise<void> {
  const active = await liveRepo.findActiveForUser(userId);
  if (!active) return;
  await liveRepo.end(userId);
  await fanOutEnded(userId);
}

async function fanOutEnded(userId: string): Promise<void> {
  logger.info({ event: 'live.ended', userId }, 'live ended');
  const io = getIo();
  if (!io) return;
  const payload = { userId };
  for (const friendId of await social.friendIds(userId)) {
    io.to(`user:${friendId}`).emit(SERVER_EVENTS.LIVE_ENDED, payload);
  }
}
