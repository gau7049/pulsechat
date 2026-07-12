import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import * as authTokens from '../repositories/auth-token.repository.js';
import * as devices from '../repositories/device.repository.js';
import * as users from '../repositories/user.repository.js';
import type { RequestContext } from './auth.service.js';
import { recordAudit } from './audit.service.js';
import { accountRestoreEmail, sendEmail } from './email.service.js';
import { verifyPassword } from './password.service.js';
import { generateEmailToken, sha256 } from './token.service.js';

/**
 * Account lifecycle (Requirement Scope §16): deactivate/delete are
 * self-service and reversible in different ways — deactivated restores on
 * the next login (already wired in `auth.service.login`), deleted only
 * through the explicit restore-email flow below. Both revoke every session,
 * including the one making the request.
 */

const RESTORE_TTL_MS = 30 * 60 * 1000;

async function requirePassword(userId: string, currentPassword: string) {
  const user = await users.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', {
      currentPassword: ['Current password is incorrect'],
    });
  }
  return user;
}

export async function deactivate(
  userId: string,
  currentPassword: string,
  context: RequestContext,
): Promise<void> {
  await requirePassword(userId, currentPassword);
  await users.updateUser(userId, { status: 'deactivated' });
  await devices.revokeAllForUser(userId);
  await recordAudit(userId, 'account_deactivated', { ip: context.ip, device: context.userAgent });
  logger.info({ event: 'account.deactivated', userId }, 'account deactivated');
}

export async function deleteAccount(
  userId: string,
  currentPassword: string,
  context: RequestContext,
): Promise<void> {
  await requirePassword(userId, currentPassword);
  await users.updateUser(userId, { status: 'deleted' });
  await devices.revokeAllForUser(userId);
  await recordAudit(userId, 'account_deleted', { ip: context.ip, device: context.userAgent });
  logger.info({ event: 'account.deleted', userId }, 'account deleted');
}

/** Only proceeds for a `deleted` account; silently succeeds otherwise (no enumeration). */
export async function requestRestore(username: string): Promise<void> {
  const user = await users.findByUsername(username);
  if (!user || user.status !== 'deleted' || !user.email) {
    logger.info({ event: 'account.restore_request_ignored' }, 'restore request ignored');
    return;
  }
  await authTokens.invalidateUserTokens(user.id, 'account_restore');
  const { token, tokenHash } = generateEmailToken();
  await authTokens.createAuthToken({
    userId: user.id,
    type: 'account_restore',
    tokenHash,
    expiresAt: new Date(Date.now() + RESTORE_TTL_MS),
  });
  await sendEmail(
    accountRestoreEmail(user.email, `${env.APP_ORIGIN}/restore-account/confirm?token=${token}`),
  );
}

export async function confirmRestore(rawToken: string, context: RequestContext): Promise<void> {
  const record = await authTokens.findValidToken(sha256(rawToken), 'account_restore');
  if (!record) throw new AppError('UNAUTHORIZED', 'This restoration link is invalid or expired');
  await authTokens.consumeToken(record.id);
  await users.updateUser(record.userId, { status: 'active' });
  await recordAudit(record.userId, 'account_restored', {
    ip: context.ip,
    device: context.userAgent,
  });
  logger.info({ event: 'account.restored', userId: record.userId }, 'account restored');
}

export interface ExportedAccountData {
  profile: Record<string, unknown>;
  posts: unknown[];
  messages: { note: string; items: unknown[] };
  exportedAt: string;
}

export async function exportData(userId: string): Promise<ExportedAccountData> {
  const user = await users.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  const [posts, messages] = await Promise.all([
    prisma.post.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.message.findMany({ where: { senderId: userId }, orderBy: { createdAt: 'asc' } }),
  ]);

  const profile: Record<string, unknown> = { ...user };
  delete profile.passwordHash;

  return {
    profile,
    posts,
    messages: {
      note:
        'Message bodies are end-to-end encrypted (Technical Spec §6) — only your own device holds ' +
        'the key to decrypt them. This export contains ciphertext plus metadata for backup/portability.',
      items: messages,
    },
    exportedAt: new Date().toISOString(),
  };
}
