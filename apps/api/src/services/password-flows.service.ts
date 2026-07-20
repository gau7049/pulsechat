import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';
import * as authTokens from '../repositories/auth-token.repository.js';
import * as devices from '../repositories/device.repository.js';
import * as users from '../repositories/user.repository.js';
import type { UserWithPrivacy } from '../repositories/user.repository.js';
import { recordAudit } from './audit.service.js';
import { passwordResetEmail, sendEmail } from './email.service.js';
import { hashPassword, verifyPassword } from './password.service.js';
import { generateEmailToken, sha256 } from './token.service.js';
import type { RequestContext } from './auth.service.js';

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** §6.3 change password — requires the current one; revokes all other sessions. */
export async function changePassword(
  userId: string,
  currentDeviceId: string,
  currentPassword: string,
  newPassword: string,
  context: RequestContext,
): Promise<void> {
  const user = await users.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', {
      currentPassword: ['Current password is incorrect'],
    });
  }
  await users.updateUser(userId, { passwordHash: await hashPassword(newPassword) });
  const revoked = await devices.revokeAllForUser(userId, currentDeviceId);
  logger.info(
    { event: 'auth.password_changed', userId, revokedSessions: revoked },
    'password changed; other sessions revoked',
  );
  await recordAudit(userId, 'password_changed', { ip: context.ip, device: context.userAgent });
}

/**
 * Encryption-key recovery: a device that lost its local keypair generates a
 * fresh one and registers it as the account's public key, so it can start
 * new conversations again. Existing conversations' wrapped keys were sealed
 * to the old public key and stay unreadable — there is no rewrap mechanism
 * (see chat-keys.ts / conversation-keys.ts comments). Password-gated the
 * same way as changePassword, not step-up — the caller already needs the
 * plaintext password locally to re-derive the Argon2id wrap.
 */
export async function rotateEncryptionKey(
  userId: string,
  currentPassword: string,
  publicKey: string,
  context: RequestContext,
): Promise<UserWithPrivacy> {
  const user = await users.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) {
    throw new AppError('VALIDATION_FAILED', 'Current password is incorrect', {
      currentPassword: ['Current password is incorrect'],
    });
  }
  const updated = await users.updateUser(userId, { publicKey });
  await recordAudit(userId, 'encryption_key_rotated', { ip: context.ip, device: context.userAgent });
  return updated;
}

/** §6.3 forgot password — emails a single-use reset link when the email exists. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await users.findByEmail(email);
  if (!user || user.status === 'deleted') return; // never confirm existence
  await authTokens.invalidateUserTokens(user.id, 'password_reset');
  const { token, tokenHash } = generateEmailToken();
  await authTokens.createAuthToken({
    userId: user.id,
    type: 'password_reset',
    tokenHash,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });
  await sendEmail(passwordResetEmail(email, `${env.APP_ORIGIN}/reset-password?token=${token}`));
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  context: RequestContext,
): Promise<void> {
  const record = await authTokens.findValidToken(sha256(rawToken), 'password_reset');
  if (!record) throw new AppError('UNAUTHORIZED', 'This reset link is invalid or expired');
  await authTokens.consumeToken(record.id);
  await users.updateUser(record.userId, { passwordHash: await hashPassword(newPassword) });
  // A reset means the old password may be compromised — sign out everywhere.
  await devices.revokeAllForUser(record.userId);
  await recordAudit(record.userId, 'password_reset', {
    ip: context.ip,
    device: context.userAgent,
  });
}
