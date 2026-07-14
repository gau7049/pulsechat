import { randomBytes } from 'node:crypto';
import type { InviteDto, InviteLookupDto } from '@pulsechat/shared';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../http/errors.js';
import { notifySuggestedConnections, sendFriendRequest } from './social.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Personal invite links (Requirement Scope §10.3): one durable code per user;
 * opening it lands on registration, and signing up through it connects the
 * new account to the inviter with a friend request.
 */

export async function getOrCreateInvite(userId: string): Promise<InviteDto> {
  const existing = await prisma.invite.findFirst({ where: { userId } });
  if (existing) return { code: existing.code };

  // 9 random bytes → 12 url-safe chars; retry the astronomically rare collision.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = randomBytes(9).toString('base64url');
    try {
      const invite = await prisma.invite.create({ data: { code, userId } });
      return { code: invite.code };
    } catch {
      // Code collision — generate a fresh one.
    }
  }
  throw new AppError('INTERNAL', 'Could not generate an invite code');
}

export async function lookupInvite(code: string): Promise<InviteLookupDto> {
  const invite = await prisma.invite.findUnique({ where: { code }, include: { user: true } });
  if (!invite || invite.user.status !== 'active') {
    throw new AppError('NOT_FOUND', 'This invite link is no longer valid');
  }
  return { inviter: toUserSummaryDto(invite.user) };
}

/**
 * Post-registration hook: connect the new user to their inviter (§10.3), and
 * — §24.5 — notify the inviter's other friends that someone they may know
 * just joined. Best-effort — a stale code must never fail the signup that
 * carried it.
 */
export async function linkInviteOnRegister(
  newUser: { id: string; username: string; displayName: string; avatarUrl: string | null },
  code: string,
): Promise<void> {
  try {
    const invite = await prisma.invite.findUnique({ where: { code }, include: { user: true } });
    if (!invite || invite.user.status !== 'active' || invite.userId === newUser.id) return;
    await sendFriendRequest(newUser.id, invite.userId, { viaInvite: true });
    logger.info(
      { event: 'invite.linked', inviterId: invite.userId, newUserId: newUser.id },
      'invite linked to signup',
    );
    void notifySuggestedConnections(invite.userId, newUser);
  } catch (error) {
    logger.warn(
      { event: 'invite.link_failed', newUserId: newUser.id, err: error },
      'invite link failed',
    );
  }
}
