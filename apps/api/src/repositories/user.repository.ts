import type { Prisma, User, PrivacySetting } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export type UserWithPrivacy = User & { privacy: PrivacySetting | null };

export function findByUsername(username: string): Promise<UserWithPrivacy | null> {
  return prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    include: { privacy: true },
  });
}

export function findById(id: string): Promise<UserWithPrivacy | null> {
  return prisma.user.findUnique({ where: { id }, include: { privacy: true } });
}

export function findByEmail(email: string): Promise<UserWithPrivacy | null> {
  return prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { privacy: true },
  });
}

export function createUser(data: {
  username: string;
  displayName: string;
  passwordHash: string;
  email?: string;
  birthDate?: Date;
  publicKey: string;
}): Promise<UserWithPrivacy> {
  return prisma.user.create({
    data: { ...data, privacy: { create: {} } },
    include: { privacy: true },
  });
}

export function updateUser(id: string, data: Prisma.UserUpdateInput): Promise<UserWithPrivacy> {
  return prisma.user.update({ where: { id }, data, include: { privacy: true } });
}

/**
 * Username/display-name search (Requirement Scope §9). Ordered by username —
 * unique, so it doubles as a stable keyset cursor.
 */
export function searchActiveUsers(options: {
  q: string;
  excludeIds: string[];
  cursorUsername?: string;
  limit: number;
}): Promise<UserWithPrivacy[]> {
  return prisma.user.findMany({
    where: {
      status: 'active',
      id: { notIn: options.excludeIds },
      OR: [
        { username: { contains: options.q, mode: 'insensitive' } },
        { displayName: { contains: options.q, mode: 'insensitive' } },
      ],
    },
    include: { privacy: true },
    orderBy: { username: 'asc' },
    take: options.limit,
    ...(options.cursorUsername ? { cursor: { username: options.cursorUsername }, skip: 1 } : {}),
  });
}

export function findManyByIds(ids: string[]): Promise<UserWithPrivacy[]> {
  return prisma.user.findMany({
    where: { id: { in: ids }, status: 'active' },
    include: { privacy: true },
  });
}

/**
 * "People you may know" filler (§10.1): any active account not already
 * excluded, newest signups first — used once the friends-of-friends signal
 * runs out (or doesn't exist yet, e.g. a brand-new account with no friends).
 */
export function listActiveUsersExcluding(
  excludeIds: string[],
  limit: number,
): Promise<UserWithPrivacy[]> {
  return prisma.user.findMany({
    where: { status: 'active', id: { notIn: excludeIds } },
    include: { privacy: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function countPosts(authorId: string): Promise<number> {
  return prisma.post.count({ where: { authorId } });
}

export function updatePrivacy(
  userId: string,
  data: Prisma.PrivacySettingUpdateInput,
): Promise<PrivacySetting> {
  return prisma.privacySetting.update({ where: { userId }, data });
}
