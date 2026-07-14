import type { Device } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export function findActiveByFingerprint(
  userId: string,
  deviceFingerprint: string,
): Promise<Device | null> {
  return prisma.device.findFirst({
    where: { userId, deviceFingerprint, revokedAt: null },
  });
}

export function findActiveByRefreshHash(refreshTokenHash: string): Promise<Device | null> {
  return prisma.device.findFirst({ where: { refreshTokenHash, revokedAt: null } });
}

/**
 * §6.2 reused/stolen-token detection: a hash that matches the *previous*
 * (already rotated-away) token on some device means that token is being
 * replayed — the signal a plain "unknown hash" 401 can't distinguish from a
 * genuinely expired/garbage token.
 */
export function findByPreviousRefreshHash(
  previousRefreshTokenHash: string,
): Promise<Device | null> {
  return prisma.device.findFirst({ where: { previousRefreshTokenHash, revokedAt: null } });
}

export function findActiveById(id: string): Promise<Device | null> {
  return prisma.device.findFirst({ where: { id, revokedAt: null } });
}

export function listActiveForUser(userId: string): Promise<Device[]> {
  return prisma.device.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastSeenAt: 'desc' },
  });
}

export function createDevice(data: {
  userId: string;
  deviceFingerprint: string;
  userAgent: string;
  recognized: boolean;
  refreshTokenHash?: string;
}): Promise<Device> {
  return prisma.device.create({ data });
}

export interface RefreshRotation {
  refreshTokenHash: string;
  /** The hash being replaced — recorded so a later replay of it is detectable. */
  previousRefreshTokenHash: string | null;
  rememberMe: boolean;
  refreshExpiresAt: Date;
}

export function rotateRefreshToken(deviceId: string, rotation: RefreshRotation): Promise<Device> {
  return prisma.device.update({
    where: { id: deviceId },
    data: { ...rotation, lastSeenAt: new Date() },
  });
}

/**
 * Atomic compare-and-swap rotation: only succeeds if `currentHash` still
 * matches what's stored. Closes a race where two concurrent refresh calls
 * (e.g. React StrictMode's double effect-invocation) both read the same
 * pre-rotation token — the loser now gets a clean "already rotated" signal
 * instead of silently overwriting the winner's new token.
 */
export async function rotateRefreshTokenIfCurrent(
  deviceId: string,
  currentHash: string,
  rotation: Omit<RefreshRotation, 'previousRefreshTokenHash'>,
): Promise<boolean> {
  const result = await prisma.device.updateMany({
    where: { id: deviceId, refreshTokenHash: currentHash, revokedAt: null },
    data: { ...rotation, previousRefreshTokenHash: currentHash, lastSeenAt: new Date() },
  });
  return result.count > 0;
}

export function markRecognized(deviceId: string): Promise<Device> {
  return prisma.device.update({ where: { id: deviceId }, data: { recognized: true } });
}

export function revokeDevice(deviceId: string): Promise<Device> {
  return prisma.device.update({
    where: { id: deviceId },
    data: { revokedAt: new Date(), refreshTokenHash: null },
  });
}

export async function revokeAllForUser(userId: string, exceptDeviceId?: string): Promise<number> {
  const result = await prisma.device.updateMany({
    where: { userId, revokedAt: null, ...(exceptDeviceId ? { id: { not: exceptDeviceId } } : {}) },
    data: { revokedAt: new Date(), refreshTokenHash: null },
  });
  return result.count;
}
