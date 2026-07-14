import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { LIMITS } from '@pulsechat/shared';
import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';

/**
 * JWT + refresh-token machinery (Technical Spec §5): short-lived access token
 * (~15 min), rotating refresh token stored hashed on the Device row, and
 * short-lived single-purpose tokens for pending-2FA logins.
 */

const ACCESS_TOKEN_TTL = '15m';
const PENDING_2FA_TTL = '10m';
const STEP_UP_TTL = `${LIMITS.STEP_UP_TTL_MINUTES}m`;

export interface AccessTokenClaims {
  sub: string;
  role: 'user' | 'admin';
  deviceId: string;
}

function secret(kind: 'access' | 'refresh'): Uint8Array {
  const value = kind === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  if (!value) {
    throw new Error(`JWT_${kind.toUpperCase()}_SECRET is not configured — see .env.example`);
  }
  return new TextEncoder().encode(value);
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ role: claims.role, deviceId: claims.deviceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret('access'));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secret('access'));
    if (!payload.sub || typeof payload.deviceId !== 'string') throw new Error('bad claims');
    return {
      sub: payload.sub,
      role: payload.role === 'admin' ? 'admin' : 'user',
      deviceId: payload.deviceId,
    };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired access token');
  }
}

/**
 * Pending-2FA token: proves the password step passed while the OTP step is
 * still outstanding. Signed with the refresh secret so it can never be used
 * as an access token.
 */
export async function signPendingToken(
  userId: string,
  deviceFingerprint: string,
  rememberMe: boolean,
): Promise<string> {
  return new SignJWT({ purpose: '2fa', fp: deviceFingerprint, rememberMe })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(PENDING_2FA_TTL)
    .sign(secret('refresh'));
}

export async function verifyPendingToken(
  token: string,
): Promise<{ userId: string; deviceFingerprint: string; rememberMe: boolean }> {
  try {
    const { payload } = await jwtVerify(token, secret('refresh'));
    if (payload.purpose !== '2fa' || !payload.sub || typeof payload.fp !== 'string') {
      throw new Error('bad claims');
    }
    return {
      userId: payload.sub,
      deviceFingerprint: payload.fp,
      rememberMe: Boolean(payload.rememberMe),
    };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Sign-in session expired — start again');
  }
}

/**
 * §6.2 step-up re-auth: proves a fresh password confirmation for sensitive
 * actions that don't already inline one. Bound to both the user and the
 * specific device/session so a token can't be replayed from elsewhere.
 */
export async function signStepUpToken(userId: string, deviceId: string): Promise<string> {
  return new SignJWT({ purpose: 'step-up', deviceId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(STEP_UP_TTL)
    .sign(secret('access'));
}

export async function verifyStepUpToken(
  token: string,
): Promise<{ userId: string; deviceId: string }> {
  try {
    const { payload } = await jwtVerify(token, secret('access'));
    if (payload.purpose !== 'step-up' || !payload.sub || typeof payload.deviceId !== 'string') {
      throw new Error('bad claims');
    }
    return { userId: payload.sub, deviceId: payload.deviceId };
  } catch {
    throw new AppError('STEP_UP_REQUIRED', 'This action requires re-entering your password');
  }
}

/** Opaque refresh token: 256 random bits; only its SHA-256 lands in the DB. */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

/** Raw random token for emailed links/codes; DB stores the hash only. */
export function generateEmailToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

export function generateOtpCode(): { code: string; codeHash: string } {
  // 6 digits, crypto-random, leading zeros preserved.
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
  return { code, codeHash: sha256(code) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
