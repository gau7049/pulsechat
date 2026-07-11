import type { Prisma } from '@prisma/client';
import { SERVER_EVENTS, type UserSummaryDto } from '@pulsechat/shared';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

/**
 * Persists a Notification row and pushes it live over `notification:new`
 * (Technical Spec §9). The notification center UI arrives in M7; rows created
 * from M2 onward so history is already there.
 */
export type NotificationType = 'friend_request' | 'friend_accept';

export async function notify(
  userId: string,
  type: NotificationType,
  payload: { from: UserSummaryDto } & Record<string, unknown>,
): Promise<void> {
  try {
    const row = await prisma.notification.create({
      data: { userId, type, payloadJson: payload as unknown as Prisma.InputJsonValue },
    });
    getIo()
      ?.to(`user:${userId}`)
      .emit(SERVER_EVENTS.NOTIFICATION_NEW, {
        id: row.id,
        type,
        payload,
        createdAt: row.createdAt.toISOString(),
      });
    logger.info({ event: 'notification.sent', type, userId }, 'notification sent');
  } catch (error) {
    // Notifications are best-effort; never fail the action that caused one.
    logger.error({ event: 'notification.failed', type, userId, err: error }, 'notify failed');
  }
}
