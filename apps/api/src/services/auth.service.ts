import { LIMITS, type RegisterBody } from '@pulsechat/shared';
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
  signStepUpToken,
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
  rememberMe: boolean;
}

/**
 * §6.2 remember me: 30 days when the caller opted in, a short
 * defense-in-depth cap otherwise (the browser-session cookie is the primary
 * mechanism — this bounds a token that somehow outlives its cookie).
 */
export function computeRefreshExpiry(rememberMe: boolean): Date {
  const ms = rememberMe
    ? LIMITS.REMEMBER_ME_REFRESH_DAYS * 24 * 60 * 60 * 1000
    : LIMITS.SESSION_ONLY_REFRESH_HOURS * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

/**
 * Every path that ends in "signed in" funnels through here. `rememberMe`
 * defaults true for flows that don't expose the choice (register, magic
 * link, OTP-verified login already carries it through the pending token) —
 * only the plain login form's checkbox can turn it off.
 */
export async function issueSession(
  user: UserWithPrivacy,
  deviceFingerprint: string,
  context: RequestContext,
  options: { markRecognized: boolean; rememberMe?: boolean },
): Promise<IssuedSession> {
  const rememberMe = options.rememberMe ?? true;
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
  await devices.rotateRefreshToken(device.id, {
    refreshTokenHash: tokenHash,
    previousRefreshTokenHash: device.refreshTokenHash,
    rememberMe,
    refreshExpiresAt: computeRefreshExpiry(rememberMe),
  });
  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    deviceId: device.id,
  });
  // Single choke point every login/register/magic-link/OTP path funnels
  // through — one instrumentation call site covers DAU/WAU + traffic (§13).
  void track('session_start', user.id);

  return { user, device, accessToken, refreshToken, rememberMe };
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
    await linkInviteOnRegister(user, body.inviteCode);
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

/**
 * For an account that skipped the optional recovery email at signup (§6.1)
 * and wants to add one from Settings afterward — previously had no code
 * path at all, leaving those accounts permanently unable to enable
 * password recovery/magic-link/2FA. Changing an existing verified email is
 * a separate, more sensitive flow and not handled here.
 */
export async function addRecoveryEmail(userId: string, email: string): Promise<UserWithPrivacy> {
  const user = await users.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  if (user.email) {
    throw new AppError('VALIDATION_FAILED', 'This account already has a recovery email');
  }
  const emailTaken = await users.findByEmail(email);
  if (emailTaken) {
    throw new AppError('CONFLICT', 'This email is already in use', {
      email: ['This email is already linked to another account'],
    });
  }
  const updated = await users.updateUser(userId, { email, emailVerified: false });
  await sendVerificationEmail(userId, email);
  return updated;
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
  rememberMe: boolean,
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
    const pendingToken = await signPendingToken(currentUser.id, deviceFingerprint, rememberMe);
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
    rememberMe,
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
  rememberMe: boolean,
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
  const session = await issueSession(user, deviceFingerprint, context, {
    markRecognized: true,
    rememberMe,
  });
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

/**
 * Deliberately reveals whether the email is registered (product decision,
 * accepted trade-off for a small personal-project user base — an
 * enumeration risk unlike the otherwise-identical "forgot password" flow,
 * which stays silent).
 */
export async function requestMagicLink(
  email: string,
): Promise<{ sent: true } | { sent: false; reason: string }> {
  const user = await users.findByEmail(email);
  if (!user || user.status === 'deleted') {
    return { sent: false, reason: 'No account found with that email' };
  }
  if (!user.emailVerified) {
    return {
      sent: false,
      reason: "This email hasn't been verified yet — check your inbox, or sign in with your password",
    };
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
  return { sent: true };
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

/**
 * §6.2 reuse-detection grace window: two legitimate concurrent requests for
 * the same pre-rotation token (e.g. React StrictMode's double effect-
 * invocation — already handled below via the CAS) can also land as one
 * request seeing the *other's* already-rotated result a few milliseconds
 * later, which looks identical to token replay at the DB level. Only treat
 * it as theft once it's well outside how long a genuine race could ever take.
 */
const REUSE_GRACE_MS = 5000;

export async function refreshSession(
  rawRefreshToken: string,
  context: RequestContext,
): Promise<IssuedSession> {
  const currentHash = sha256(rawRefreshToken);
  const device = await devices.findActiveByRefreshHash(currentHash);
  if (!device) {
    // §6.2 reused/stolen-token detection: this hash isn't anyone's *current*
    // token — check whether it's one that was already rotated away. A hit
    // outside the grace window means the token is being replayed (theft
    // signal a plain "unknown hash" can't distinguish from an ordinary
    // expired/garbage token); a hit inside it is treated as a benign
    // concurrent duplicate, same as the CAS race case below.
    const reused = await devices.findByPreviousRefreshHash(currentHash);
    if (reused && Date.now() - reused.lastSeenAt.getTime() > REUSE_GRACE_MS) {
      await devices.revokeAllForUser(reused.userId);
      await recordAudit(reused.userId, 'refresh_token_reuse_detected', {
        ip: context.ip,
        device: context.userAgent,
      });
      logger.warn(
        { event: 'auth.refresh_reuse_detected', userId: reused.userId, deviceId: reused.id },
        'refresh token reuse detected — all sessions revoked',
      );
    }
    throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');
  }

  if (device.refreshExpiresAt && device.refreshExpiresAt.getTime() < Date.now()) {
    await devices.revokeDevice(device.id);
    throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');
  }

  const user = await users.findById(device.userId);
  if (!user || user.status !== 'active') {
    throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');
  }

  const { token: refreshToken, tokenHash } = generateRefreshToken();
  // Compare-and-swap: a concurrent duplicate request for the same (now
  // stale) token loses cleanly here instead of clobbering the winner's
  // rotation or getting a false "session expired" for a session that's
  // actually still fine on the other request.
  const rotated = await devices.rotateRefreshTokenIfCurrent(device.id, currentHash, {
    refreshTokenHash: tokenHash,
    rememberMe: device.rememberMe,
    refreshExpiresAt: computeRefreshExpiry(device.rememberMe),
  });
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
  return { user, device, accessToken, refreshToken, rememberMe: device.rememberMe };
}

export async function logout(deviceId: string, context: RequestContext): Promise<void> {
  const device = await devices.findActiveById(deviceId);
  if (device) {
    await devices.revokeDevice(device.id);
    await recordAudit(device.userId, 'logout', { ip: context.ip, device: context.userAgent });
  }
}

// ── Step-up re-auth (§6.2) ───────────────────────────────────────────────────

/**
 * Re-confirms the current password and issues a short-lived step-up token,
 * bound to this user + device, for sensitive endpoints that don't already
 * inline a password check (`requireStepUp` middleware verifies it).
 */
export async function stepUp(
  userId: string,
  deviceId: string,
  password: string,
): Promise<{ stepUpToken: string }> {
  const user = await users.findById(userId);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    throw new AppError('VALIDATION_FAILED', 'Password is incorrect', {
      password: ['Password is incorrect'],
    });
  }
  return { stepUpToken: await signStepUpToken(userId, deviceId) };
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const visible = (local ?? '').slice(0, 2);
  return `${visible}${'*'.repeat(Math.max((local ?? '').length - 2, 1))}@${domain ?? ''}`;
}
