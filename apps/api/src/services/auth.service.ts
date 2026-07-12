import type { RegisterBody } from '@pulsechat/shared';
import type { Device } from '@prisma/client';
import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';
import * as authTokens from '../repositories/auth-token.repository.js';
import * as devices from '../repositories/device.repository.js';
import * as users from '../repositories/user.repository.js';
import type { UserWithPrivacy } from '../repositories/user.repository.js';
import { track } from './analytics.service.js';
import { recordAudit } from './audit.service.js';
import { linkInviteOnRegister } from './invite.service.js';
import {
  magicLinkEmail,
  newDeviceEmail,
  otpEmail,
  sendEmail,
  verificationEmail,
} from './email.service.js';
import { hashPassword, verifyPassword } from './password.service.js';
import {
  generateEmailToken,
  generateOtpCode,
  generateRefreshToken,
  signAccessToken,
  signPendingToken,
  sha256,
} from './token.service.js';

const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const DEVICE_CONFIRM_TTL_MS = 30 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export interface RequestContext {
  ip: string;
  userAgent: string;
}

export interface IssuedSession {
  user: UserWithPrivacy;
  device: Device;
  accessToken: string;
  refreshToken: string;
}

/** Every path that ends in "signed in" funnels through here. */
export async function issueSession(
  user: UserWithPrivacy,
  deviceFingerprint: string,
  context: RequestContext,
  options: { markRecognized: boolean },
): Promise<IssuedSession> {
  let device = await devices.findActiveByFingerprint(user.id, deviceFingerprint);
  if (!device) {
    device = await devices.createDevice({
      userId: user.id,
      deviceFingerprint,
      userAgent: context.userAgent,
      recognized: options.markRecognized,
    });
  } else if (options.markRecognized && !device.recognized) {
    device = await devices.markRecognized(device.id);
  }

  const { token: refreshToken, tokenHash } = generateRefreshToken();
  await devices.rotateRefreshToken(device.id, tokenHash);
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    deviceId: device.id,
  });
  // Single choke point every login/register/magic-link/OTP path funnels
  // through — one instrumentation call site covers DAU/WAU + traffic (§13).
  void track('session_start', user.id);

  return { user, device, accessToken, refreshToken };
}

// ── Registration ─────────────────────────────────────────────────────────────

export async function register(
  body: RegisterBody,
  deviceFingerprint: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const existing = await users.findByUsername(body.username);
  if (existing) {
    throw new AppError('CONFLICT', 'This username is already taken', {
      username: ['This username is already taken'],
    });
  }
  if (body.email) {
    const emailTaken = await users.findByEmail(body.email);
    if (emailTaken) {
      throw new AppError('CONFLICT', 'This email is already in use', {
        email: ['This email is already linked to another account'],
      });
    }
  }

  const passwordHash = await hashPassword(body.password);
  const user = await users.createUser({
    username: body.username,
    displayName: body.displayName,
    passwordHash,
    email: body.email,
    birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
    publicKey: body.publicKey,
  });

  if (body.email) {
    await sendVerificationEmail(user.id, body.email);
  }
  if (body.inviteCode) {
    // §10.3: signing up through an invite connects the new user to the inviter.
    await linkInviteOnRegister(user.id, body.inviteCode);
  }

  await recordAudit(user.id, 'register', { ip: context.ip, device: context.userAgent });
  // The registering device is inherently trusted (§6.6 applies to *new* devices).
  return issueSession(user, deviceFingerprint, context, { markRecognized: true });
}

export async function sendVerificationEmail(userId: string, email: string): Promise<void> {
  await authTokens.invalidateUserTokens(userId, 'verify_email');
  const { token, tokenHash } = generateEmailToken();
  await authTokens.createAuthToken({
    userId,
    type: 'verify_email',
    tokenHash,
    expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
  });
  await sendEmail(verificationEmail(email, `${env.APP_ORIGIN}/verify-email?token=${token}`));
}

// ── Login ────────────────────────────────────────────────────────────────────

export type LoginOutcome =
  | { kind: 'session'; session: IssuedSession }
  | { kind: 'otp_required'; pendingToken: string }
  | { kind: 'device_confirm_required'; maskedEmail: string };

export async function login(
  username: string,
  password: string,
  deviceFingerprint: string,
  context: RequestContext,
): Promise<LoginOutcome> {
  const user = await users.findByUsername(username);
  const passwordOk = user ? await verifyPassword(user.passwordHash, password) : false;
  if (!user || !passwordOk) {
    if (user) {
      await recordAudit(user.id, 'login_failed', { ip: context.ip, device: context.userAgent });
    }
    // Same error whether the username or the password is wrong.
    throw new AppError('UNAUTHORIZED', 'Incorrect username or password');
  }

  if (user.status === 'deleted') {
    throw new AppError(
      'FORBIDDEN',
      'This account was deleted — use account restoration to reclaim it',
    );
  }
  if (user.status === 'suspended') {
    // §18 moderation suspension — unlike deactivated/deleted, there is no
    // self-service path back; only PATCH /admin/users/:id/status lifts it.
    throw new AppError('FORBIDDEN', 'This account was suspended by moderation');
  }
  let currentUser = user;
  if (user.status === 'deactivated') {
    // §16: logging back in restores a temporarily deactivated account.
    currentUser = await users.updateUser(user.id, { status: 'active' });
    logger.info({ event: 'account.reactivated', userId: user.id }, 'account reactivated by login');
  }

  // Optional email-OTP 2FA (§6.5) takes precedence over the new-device check —
  // the OTP already proves control of the registered email.
  if (currentUser.otpEnabled && currentUser.emailVerified && currentUser.email) {
    await issueOtp(currentUser.id, currentUser.email);
    const pendingToken = await signPendingToken(currentUser.id, deviceFingerprint);
    return { kind: 'otp_required', pendingToken };
  }

  // New-device confirmation (§6.6) — only when a verified recovery email exists.
  if (currentUser.emailVerified && currentUser.email) {
    const known = await devices.findActiveByFingerprint(currentUser.id, deviceFingerprint);
    if (!known || !known.recognized) {
      await startDeviceConfirmation(currentUser, deviceFingerprint, context);
      return { kind: 'device_confirm_required', maskedEmail: maskEmail(currentUser.email) };
    }
  }

  const session = await issueSession(currentUser, deviceFingerprint, context, {
    markRecognized: true,
  });
  await recordAudit(currentUser.id, 'login', { ip: context.ip, device: context.userAgent });
  return { kind: 'session', session };
}

async function issueOtp(userId: string, email: string): Promise<void> {
  await authTokens.invalidateUserTokens(userId, 'otp');
  const { code, codeHash } = generateOtpCode();
  await authTokens.createAuthToken({
    userId,
    type: 'otp',
    tokenHash: codeHash,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await sendEmail(otpEmail(email, code));
}

export async function verifyOtp(
  userId: string,
  deviceFingerprint: string,
  code: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const live = await authTokens.findLiveOtp(userId);
  if (!live) throw new AppError('UNAUTHORIZED', 'Code expired — sign in again');
  if (live.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AppError('RATE_LIMITED', 'Too many wrong codes — sign in again');
  }
  if (live.tokenHash !== sha256(code)) {
    await authTokens.incrementAttempts(live.id);
    throw new AppError('UNAUTHORIZED', 'Incorrect code');
  }
  await authTokens.consumeToken(live.id);

  const user = await users.findById(userId);
  if (!user || user.status === 'deleted') throw new AppError('UNAUTHORIZED', 'Account unavailable');
  const session = await issueSession(user, deviceFingerprint, context, { markRecognized: true });
  await recordAudit(user.id, 'login', { ip: context.ip, device: context.userAgent });
  return session;
}

// ── New-device confirmation (§6.6) ───────────────────────────────────────────

async function startDeviceConfirmation(
  user: UserWithPrivacy,
  deviceFingerprint: string,
  context: RequestContext,
): Promise<void> {
  await authTokens.invalidateUserTokens(user.id, 'device_confirm');
  const { token, tokenHash } = generateEmailToken();
  await authTokens.createAuthToken({
    userId: user.id,
    type: 'device_confirm',
    tokenHash,
    deviceFingerprint,
    expiresAt: new Date(Date.now() + DEVICE_CONFIRM_TTL_MS),
  });
  await sendEmail(
    newDeviceEmail(
      user.email as string,
      `${env.APP_ORIGIN}/confirm-device?token=${token}`,
      context.userAgent,
    ),
  );
  await recordAudit(user.id, 'new_device_pending', { ip: context.ip, device: context.userAgent });
}

/**
 * Called from the emailed "Yes, it's me" link. Marks the fingerprint
 * recognized; the pending device's login completes on its next attempt.
 */
export async function confirmDevice(rawToken: string, context: RequestContext): Promise<void> {
  const record = await authTokens.findValidToken(sha256(rawToken), 'device_confirm');
  if (!record || !record.deviceFingerprint) {
    throw new AppError('UNAUTHORIZED', 'This confirmation link is invalid or expired');
  }
  await authTokens.consumeToken(record.id);

  const user = await users.findById(record.userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');

  const existing = await devices.findActiveByFingerprint(user.id, record.deviceFingerprint);
  if (existing) {
    await devices.markRecognized(existing.id);
  } else {
    await devices.createDevice({
      userId: user.id,
      deviceFingerprint: record.deviceFingerprint,
      userAgent: context.userAgent,
      recognized: true,
    });
  }
  await recordAudit(user.id, 'new_device_confirmed', {
    ip: context.ip,
    device: context.userAgent,
  });
}

// ── Magic link (§6.2) ────────────────────────────────────────────────────────

export async function requestMagicLink(email: string): Promise<void> {
  const user = await users.findByEmail(email);
  // Silently succeed for unknown emails — never confirm account existence.
  if (!user || !user.emailVerified || user.status === 'deleted') {
    logger.info({ event: 'auth.magic_link_unknown_email' }, 'magic link for unknown email ignored');
    return;
  }
  await authTokens.invalidateUserTokens(user.id, 'magic_link');
  const { token, tokenHash } = generateEmailToken();
  await authTokens.createAuthToken({
    userId: user.id,
    type: 'magic_link',
    tokenHash,
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
  });
  await sendEmail(magicLinkEmail(email, `${env.APP_ORIGIN}/magic-link?token=${token}`));
}

export async function verifyMagicLink(
  rawToken: string,
  deviceFingerprint: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const record = await authTokens.findValidToken(sha256(rawToken), 'magic_link');
  if (!record) throw new AppError('UNAUTHORIZED', 'This sign-in link is invalid or expired');
  await authTokens.consumeToken(record.id);

  const user = await users.findById(record.userId);
  if (!user || user.status === 'deleted') throw new AppError('UNAUTHORIZED', 'Account unavailable');
  if (user.status === 'deactivated') await users.updateUser(user.id, { status: 'active' });

  // The link proves email control, so the §6.6 check is satisfied by definition.
  const session = await issueSession(user, deviceFingerprint, context, { markRecognized: true });
  await recordAudit(user.id, 'magic_link_login', { ip: context.ip, device: context.userAgent });
  return session;
}

// ── Email verification ───────────────────────────────────────────────────────

export async function verifyEmail(rawToken: string, context: RequestContext): Promise<void> {
  const record = await authTokens.findValidToken(sha256(rawToken), 'verify_email');
  if (!record) throw new AppError('UNAUTHORIZED', 'This verification link is invalid or expired');
  await authTokens.consumeToken(record.id);
  await users.updateUser(record.userId, { emailVerified: true });
  await recordAudit(record.userId, 'email_verified', { ip: context.ip, device: context.userAgent });
}

// ── Refresh / logout ─────────────────────────────────────────────────────────

export async function refreshSession(
  rawRefreshToken: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const currentHash = sha256(rawRefreshToken);
  const device = await devices.findActiveByRefreshHash(currentHash);
  if (!device) throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');

  const user = await users.findById(device.userId);
  if (!user || user.status !== 'active') {
    throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');
  }

  const { token: refreshToken, tokenHash } = generateRefreshToken();
  // Compare-and-swap: a concurrent duplicate request for the same (now
  // stale) token loses cleanly here instead of clobbering the winner's
  // rotation or getting a false "session expired" for a session that's
  // actually still fine on the other request.
  const rotated = await devices.rotateRefreshTokenIfCurrent(device.id, currentHash, tokenHash);
  if (!rotated) {
    throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');
  }
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    deviceId: device.id,
  });
  logger.info(
    { event: 'auth.refresh', userId: user.id, deviceId: device.id, ip: context.ip },
    'session refreshed',
  );
  return { user, device, accessToken, refreshToken };
}

export async function logout(deviceId: string, context: RequestContext): Promise<void> {
  const device = await devices.findActiveById(deviceId);
  if (device) {
    await devices.revokeDevice(device.id);
    await recordAudit(device.userId, 'logout', { ip: context.ip, device: context.userAgent });
  }
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const visible = (local ?? '').slice(0, 2);
  return `${visible}${'*'.repeat(Math.max((local ?? '').length - 2, 1))}@${domain ?? ''}`;
}
