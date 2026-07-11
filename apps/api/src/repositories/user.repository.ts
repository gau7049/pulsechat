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

export function updatePrivacy(
  userId: string,
  data: Prisma.PrivacySettingUpdateInput,
): Promise<PrivacySetting> {
  return prisma.privacySetting.update({ where: { userId }, data });
}
