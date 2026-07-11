import type { AuthToken, AuthTokenType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export function createAuthToken(data: {
  userId: string;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  deviceFingerprint?: string;
}): Promise<AuthToken> {
  return prisma.authToken.create({ data });
}

/** Valid = matching hash+type, unconsumed, unexpired. */
export function findValidToken(tokenHash: string, type: AuthTokenType): Promise<AuthToken | null> {
  return prisma.authToken.findFirst({
    where: { tokenHash, type, consumedAt: null, expiresAt: { gt: new Date() } },
  });
}

/** Latest live OTP for a user (codes are per-user, not carried in the URL). */
export function findLiveOtp(userId: string): Promise<AuthToken | null> {
  return prisma.authToken.findFirst({
    where: { userId, type: 'otp', consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
}

export function consumeToken(id: string): Promise<AuthToken> {
  return prisma.authToken.update({ where: { id }, data: { consumedAt: new Date() } });
}

export function incrementAttempts(id: string): Promise<AuthToken> {
  return prisma.authToken.update({ where: { id }, data: { attempts: { increment: 1 } } });
}

/** Kill any earlier live tokens of a type when issuing a fresh one. */
export async function invalidateUserTokens(userId: string, type: AuthTokenType): Promise<void> {
  await prisma.authToken.updateMany({
    where: { userId, type, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}
