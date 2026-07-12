import type { CreateReportBody, Page, ReportAdminDto } from '@pulsechat/shared';
import { AppError } from '../http/errors.js';
import * as chat from '../repositories/chat.repository.js';
import * as devices from '../repositories/device.repository.js';
import * as postRepo from '../repositories/post.repository.js';
import * as reportRepo from '../repositories/report.repository.js';
import * as users from '../repositories/user.repository.js';
import { logger } from '../lib/logger.js';
import { adminDeleteMessage } from './chat.service.js';
import { notify } from './notification.service.js';
import { adminDeletePost } from './post.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/** A synthetic sender for moderation notices — no single user "sends" a warning. */
const MODERATION_SENDER = {
  id: 'system',
  username: 'pulsechat',
  displayName: 'PulseChat Moderation',
  avatarUrl: null,
};

export async function createReport(reporterId: string, body: CreateReportBody): Promise<void> {
  if (body.targetType === 'post') {
    const post = await postRepo.findById(body.targetId, reporterId);
    if (!post) throw new AppError('NOT_FOUND', 'Post not found');
  } else if (body.targetType === 'message') {
    const message = await chat.findMessageById(body.targetId);
    const membership = message
      ? await chat.getMembership(message.conversationId, reporterId)
      : null;
    if (!message || !membership) throw new AppError('NOT_FOUND', 'Message not found');
  } else {
    const user = await users.findById(body.targetId);
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
  }
  await reportRepo.create({
    reporterId,
    targetType: body.targetType,
    targetId: body.targetId,
    reason: body.reason,
  });
  logger.info({ event: 'report.created', reporterId, targetType: body.targetType }, 'report filed');
}

/**
 * Admin queue rows. Never includes message ciphertext — for a message report
 * only non-content metadata is exposed, keeping "admin cannot read chat
 * content" (§13, §18.1) literal rather than incidental.
 */
export async function listReports(options: {
  status?: 'open' | 'reviewed' | 'actioned';
  cursor?: string;
  limit: number;
}): Promise<Page<ReportAdminDto>> {
  const rows = await reportRepo.list({ ...options, limit: options.limit + 1 });
  const pageRows = rows.slice(0, options.limit);

  const items = await Promise.all(
    pageRows.map(async (report): Promise<ReportAdminDto> => {
      const reporter = await users.findById(report.reporterId);
      const preview = await buildPreview(report.targetType, report.targetId);
      return {
        id: report.id,
        reporter: reporter
          ? toUserSummaryDto(reporter)
          : { ...MODERATION_SENDER, id: report.reporterId },
        targetType: report.targetType,
        targetId: report.targetId,
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt.toISOString(),
        preview,
      };
    }),
  );

  return {
    items,
    ...(rows.length > options.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}

async function buildPreview(
  targetType: 'post' | 'message' | 'profile',
  targetId: string,
): Promise<ReportAdminDto['preview']> {
  if (targetType === 'post') {
    const post = await postRepo.findById(targetId, '');
    if (!post) return null;
    return {
      kind: 'post',
      mediaUrl: post.mediaUrl,
      caption: post.caption,
      author: toUserSummaryDto(post.author),
    };
  }
  if (targetType === 'message') {
    const message = await chat.findMessageById(targetId);
    if (!message) return null;
    const sender = await users.findById(message.senderId);
    return {
      kind: 'message',
      conversationId: message.conversationId,
      sender: sender ? toUserSummaryDto(sender) : { ...MODERATION_SENDER, id: message.senderId },
    };
  }
  const user = await users.findById(targetId);
  return user ? { kind: 'profile', user: toUserSummaryDto(user) } : null;
}

/** Resolves the underlying account a moderation action applies to. */
async function resolveTargetUserId(targetType: 'post' | 'message' | 'profile', targetId: string) {
  if (targetType === 'post') {
    const post = await postRepo.findById(targetId, '');
    return post?.authorId ?? null;
  }
  if (targetType === 'message') {
    const message = await chat.findMessageById(targetId);
    return message?.senderId ?? null;
  }
  return targetId;
}

export async function actionReport(
  reportId: string,
  action: 'warn' | 'remove' | 'suspend' | 'dismiss',
): Promise<void> {
  const report = await reportRepo.findById(reportId);
  if (!report) throw new AppError('NOT_FOUND', 'Report not found');

  if (action === 'dismiss') {
    await reportRepo.updateStatus(reportId, 'reviewed');
    return;
  }

  if (action === 'remove') {
    if (report.targetType === 'profile') {
      throw new AppError('VALIDATION_FAILED', '"remove" does not apply to a profile report');
    }
    const owner =
      report.targetType === 'post'
        ? (await adminDeletePost(report.targetId)).authorId
        : (await adminDeleteMessage(report.targetId)).senderId;
    await notify(owner, 'moderation_warning', {
      from: MODERATION_SENDER,
      reason: 'Content you posted was removed for violating PulseChat guidelines.',
    });
    await reportRepo.updateStatus(reportId, 'actioned');
    return;
  }

  const targetUserId = await resolveTargetUserId(report.targetType, report.targetId);
  if (!targetUserId) throw new AppError('NOT_FOUND', 'Reported content no longer exists');

  if (action === 'warn') {
    await notify(targetUserId, 'moderation_warning', {
      from: MODERATION_SENDER,
      reason: report.reason,
    });
  } else {
    // suspend
    await users.updateUser(targetUserId, { status: 'suspended' });
    await devices.revokeAllForUser(targetUserId);
    logger.info({ event: 'user.suspended', userId: targetUserId, reportId }, 'user suspended');
  }
  await reportRepo.updateStatus(reportId, 'actioned');
}

export async function setUserStatus(userId: string, status: 'active' | 'suspended'): Promise<void> {
  const user = await users.findById(userId);
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  await users.updateUser(userId, { status });
  if (status === 'suspended') await devices.revokeAllForUser(userId);
  logger.info({ event: 'user.status_set_by_admin', userId, status }, 'user status set by admin');
}
