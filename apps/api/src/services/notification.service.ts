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
  | 'friend_request'
  | 'friend_accept'
  | 'post_like'
  | 'post_comment'
  | 'moderation_warning'
  // §24.5/§24.6/§24.2 post-handoff addendum additions:
  | 'comment_like'
  | 'tag'
  | 'new_user_suggestion'
  // §24.10/§24.13/§24.14 M10 additions:
  | 'story_reaction'
  | 'story_poll_response'
  | 'friendship_anniversary';

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
    case 'comment_like':
      return { title: 'New like', body: `${name} liked your comment` };
    case 'tag':
      return { title: 'You were tagged', body: `${name} tagged you in a post` };
    case 'new_user_suggestion':
      return { title: 'New on PulseChat', body: `${name} just joined — add as friend?` };
    case 'story_reaction':
      return { title: 'Story reaction', body: `${name} reacted to your story` };
    case 'story_poll_response':
      return { title: 'Story response', body: `${name} responded to your story` };
    case 'friendship_anniversary':
      return {
        title: 'Friendship anniversary',
        body: `You and ${name} became friends on this day`,
      };
  }
}

/**
 * Some notification types are naturally repeatable by the same actor on the
 * same target (like → unlike → like) — while the first one is still unread,
 * a repeat shouldn't stack a second identical "X liked your post" row. This
 * returns a matcher for the existing unread row to refresh instead of
 * duplicating, or `null` for types that don't need it (a fresh event should
 * always be its own row).
 */
function dedupeMatcher(
  type: NotificationType,
  payload: Record<string, unknown>,
): ((existing: Record<string, unknown>) => boolean) | null {
  const fromId = (payload.from as UserSummaryDto | undefined)?.id;
  if (!fromId) return null;
  if (type === 'post_like' && typeof payload.postId === 'string') {
    const postId = payload.postId;
    return (p) => p.postId === postId && (p.from as UserSummaryDto | undefined)?.id === fromId;
  }
  if (type === 'comment_like' && typeof payload.commentId === 'string') {
    const commentId = payload.commentId;
    return (p) =>
      p.commentId === commentId && (p.from as UserSummaryDto | undefined)?.id === fromId;
  }
  if (type === 'story_reaction' && typeof payload.statusId === 'string') {
    const statusId = payload.statusId;
    return (p) => p.statusId === statusId && (p.from as UserSummaryDto | undefined)?.id === fromId;
  }
  return null;
}

async function findUnreadDuplicate(
  userId: string,
  type: NotificationType,
  matches: (payload: Record<string, unknown>) => boolean,
): Promise<{ id: string } | null> {
  // Bounded scan of this user's most recent unread rows of this type —
  // avoids relying on provider-specific JSON-path querying for a small,
  // naturally-recent set.
  const candidates = await prisma.notification.findMany({
    where: { userId, type, readAt: null },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  const hit = candidates.find((c) => matches(c.payloadJson as Record<string, unknown>));
  return hit ? { id: hit.id } : null;
}

export async function notify(
  userId: string,
  type: NotificationType,
  payload: { from: UserSummaryDto } & Record<string, unknown>,
): Promise<void> {
  try {
    const matcher = dedupeMatcher(type, payload);
    const duplicate = matcher ? await findUnreadDuplicate(userId, type, matcher) : null;
    const row = duplicate
      ? await prisma.notification.update({
          where: { id: duplicate.id },
          data: { payloadJson: payload as unknown as Prisma.InputJsonValue, createdAt: new Date() },
        })
      : await prisma.notification.create({
          data: { userId, type, payloadJson: payload as unknown as Prisma.InputJsonValue },
        });
    getIo()?.to(`user:${userId}`).emit(SERVER_EVENTS.NOTIFICATION_NEW, {
      id: row.id,
      type,
      payload,
      createdAt: row.createdAt.toISOString(),
    });
    logger.info(
      { event: 'notification.sent', type, userId, deduped: Boolean(duplicate) },
      'notification sent',
    );
    // A refreshed duplicate is still unread on the recipient's device from
    // the first time — don't push-alert them a second time for it.
    if (!duplicate) await sendPush(userId, { ...pushCopy(type, payload), tag: type, url: '/' });
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
