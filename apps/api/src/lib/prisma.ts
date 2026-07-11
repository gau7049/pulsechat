import { PrismaClient } from '@prisma/client';

/** Single Prisma instance per process — repositories import this, never new up their own. */
export const prisma = new PrismaClient();
