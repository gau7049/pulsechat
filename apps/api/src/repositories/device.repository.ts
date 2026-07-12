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

export function rotateRefreshToken(deviceId: string, refreshTokenHash: string): Promise<Device> {
  return prisma.device.update({
    where: { id: deviceId },
    data: { refreshTokenHash, lastSeenAt: new Date() },
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
  newHash: string,
): Promise<boolean> {
  const result = await prisma.device.updateMany({
    where: { id: deviceId, refreshTokenHash: currentHash, revokedAt: null },
    data: { refreshTokenHash: newHash, lastSeenAt: new Date() },
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
