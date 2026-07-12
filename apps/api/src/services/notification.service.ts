import type { Prisma } from '@prisma/client';
import {
  SERVER_EVENTS,
  type NotificationDto,
  type Page,
  type UserSummaryDto,
} from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { sendPush } from './push.service.js';

/**
 * Persists a Notification row, pushes it live over `notification:new`
 * (Technical Spec §9), and delivers a Web Push alert (§12) — all from one
 * call site. The notification center UI arrived in M7; rows created from M2
 * onward so history was already there.
 */
export type NotificationType =
  'friend_request' | 'friend_accept' | 'post_like' | 'post_comment' | 'moderation_warning';

/** Push copy per type — never includes message content (encryption boundary). */
function pushCopy(
  type: NotificationType,
  payload: { from: UserSummaryDto } & Record<string, unknown>,
) {
  const name = payload.from.displayName;
  switch (type) {
    case 'friend_request':
      return { title: 'New friend request', body: `${name} sent you a friend request` };
    case 'friend_accept':
      return { title: 'Friend request accepted', body: `${name} accepted your friend request` };
    case 'post_like':
      return { title: 'New like', body: `${name} liked your post` };
    case 'post_comment':
      return { title: 'New comment', body: `${name} commented on your post` };
    case 'moderation_warning':
      return {
        title: 'Moderation notice',
        body: String(payload.reason ?? 'Your content was reviewed'),
      };
  }
}

export async function notify(
  userId: string,
  type: NotificationType,
  payload: { from: UserSummaryDto } & Record<string, unknown>,
): Promise<void> {
  try {
    const row = await prisma.notification.create({
      data: { userId, type, payloadJson: payload as unknown as Prisma.InputJsonValue },
    });
    getIo()?.to(`user:${userId}`).emit(SERVER_EVENTS.NOTIFICATION_NEW, {
      id: row.id,
      type,
      payload,
      createdAt: row.createdAt.toISOString(),
    });
    logger.info({ event: 'notification.sent', type, userId }, 'notification sent');
    await sendPush(userId, { ...pushCopy(type, payload), tag: type, url: '/' });
  } catch (error) {
    // Notifications are best-effort; never fail the action that caused one.
    logger.error({ event: 'notification.failed', type, userId, err: error }, 'notify failed');
  }
}

// ── Bell menu (§12: "rendered from a bell menu, marked read on view") ───────

function toDto(row: {
  id: string;
  type: string;
  payloadJson: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    payload: (row.payloadJson ?? {}) as Record<string, unknown>,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<NotificationDto>> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: pagination.limit + 1,
    ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map(toDto),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}

export async function markRead(userId: string, notificationId: string): Promise<void> {
  const row = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!row || row.userId !== userId) throw new AppError('NOT_FOUND', 'Notification not found');
  if (!row.readAt) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}
