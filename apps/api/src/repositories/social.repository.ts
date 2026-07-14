import type { Block, CloseFriend, FriendRequest, Friendship, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for the social graph (friendships, friend requests, blocks).
 * Friendships are stored once with userAId < userBId (Technical Spec §4);
 * `pairKey` is the only place that ordering is produced.
 */

export function pairKey(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

// ── Friendships ──────────────────────────────────────────────────────────────

export function findFriendship(a: string, b: string): Promise<Friendship | null> {
  return prisma.friendship.findUnique({ where: { userAId_userBId: pairKey(a, b) } });
}

export function deleteFriendship(a: string, b: string): Promise<Friendship | null> {
  return prisma.friendship.delete({ where: { userAId_userBId: pairKey(a, b) } }).catch(() => null);
}

/** Every friend id of one user — small at product scale, used for filtering. */
export async function friendIds(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: { userAId: true, userBId: true },
  });
  return rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
}

/** Every friendship — small at product scale, same trade-off as `friendIds`; feeds the §24.14 sweep. */
export function allFriendships(): Promise<Friendship[]> {
  return prisma.friendship.findMany();
}

/** Every field `listFriends` (social.service.ts) actually reads off a friend row. */
const friendSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  publicKey: true,
} as const;
export type FriendUser = Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'publicKey'>;
export type FriendshipWithUsers = Friendship & { userA: FriendUser; userB: FriendUser };

/** One page of a user's friendships, newest first, excluding the given ids. */
export function listFriendships(
  userId: string,
  options: { excludeIds: string[]; cursor?: { userAId: string; userBId: string }; limit: number },
): Promise<FriendshipWithUsers[]> {
  return prisma.friendship.findMany({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      userAId: { notIn: options.excludeIds },
      userBId: { notIn: options.excludeIds },
    },
    include: { userA: { select: friendSelect }, userB: { select: friendSelect } },
    orderBy: [{ createdAt: 'desc' }, { userAId: 'asc' }, { userBId: 'asc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { userAId_userBId: options.cursor }, skip: 1 } : {}),
  });
}

export function countFriendships(userId: string, excludeIds: string[]): Promise<number> {
  return prisma.friendship.count({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      userAId: { notIn: excludeIds },
      userBId: { notIn: excludeIds },
    },
  });
}

/** All friendships touching any of the given users — feeds mutual counting. */
export function friendshipsOfUsers(
  userIds: string[],
): Promise<Array<Pick<Friendship, 'userAId' | 'userBId'>>> {
  return prisma.friendship.findMany({
    where: { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] },
    select: { userAId: true, userBId: true },
  });
}

// ── Friend requests ──────────────────────────────────────────────────────────

/** Every field a friend-request row's `fromUser`/`toUser` is ever read for: a `UserSummaryDto`. */
const requestUserSelect = { id: true, username: true, displayName: true, avatarUrl: true } as const;
type RequestUser = Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
export type FriendRequestWithUsers = FriendRequest & { fromUser: RequestUser; toUser: RequestUser };

export function findRequestById(id: string): Promise<FriendRequestWithUsers | null> {
  return prisma.friendRequest.findUnique({
    where: { id },
    include: { fromUser: { select: requestUserSelect }, toUser: { select: requestUserSelect } },
  });
}

/** The pending request between two users in either direction, if any. */
export function findPendingBetween(a: string, b: string): Promise<FriendRequest | null> {
  return prisma.friendRequest.findFirst({
    where: {
      status: 'pending',
      OR: [
        { fromUserId: a, toUserId: b },
        { fromUserId: b, toUserId: a },
      ],
    },
  });
}

export function countPendingOutgoing(userId: string): Promise<number> {
  return prisma.friendRequest.count({ where: { fromUserId: userId, status: 'pending' } });
}

export function listPending(
  userId: string,
  direction: 'incoming' | 'outgoing',
  options: { cursor?: string; limit: number },
): Promise<FriendRequestWithUsers[]> {
  return prisma.friendRequest.findMany({
    where: {
      status: 'pending',
      ...(direction === 'incoming' ? { toUserId: userId } : { fromUserId: userId }),
    },
    include: { fromUser: { select: requestUserSelect }, toUser: { select: requestUserSelect } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

/** Pending requests between one user and any of the given users. */
export function pendingWithUsers(
  userId: string,
  otherIds: string[],
): Promise<Array<Pick<FriendRequest, 'id' | 'fromUserId' | 'toUserId'>>> {
  return prisma.friendRequest.findMany({
    where: {
      status: 'pending',
      OR: [
        { fromUserId: userId, toUserId: { in: otherIds } },
        { toUserId: userId, fromUserId: { in: otherIds } },
      ],
    },
    select: { id: true, fromUserId: true, toUserId: true },
  });
}

/** Every user id with a pending request to or from this user. */
export async function pendingUserIds(userId: string): Promise<string[]> {
  const rows = await prisma.friendRequest.findMany({
    where: { status: 'pending', OR: [{ fromUserId: userId }, { toUserId: userId }] },
    select: { fromUserId: true, toUserId: true },
  });
  return rows.map((r) => (r.fromUserId === userId ? r.toUserId : r.fromUserId));
}

export function createRequest(fromUserId: string, toUserId: string): Promise<FriendRequest> {
  return prisma.friendRequest.create({ data: { fromUserId, toUserId } });
}

export function setRequestStatus(
  id: string,
  status: 'rejected' | 'cancelled',
): Promise<FriendRequest> {
  return prisma.friendRequest.update({ where: { id }, data: { status } });
}

/** Accept atomically: flip the request and materialize the friendship (§10). */
export function acceptRequest(id: string, fromUserId: string, toUserId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.friendRequest.update({ where: { id }, data: { status: 'accepted' } });
    await tx.friendship.upsert({
      where: { userAId_userBId: pairKey(fromUserId, toUserId) },
      create: pairKey(fromUserId, toUserId),
      update: {},
    });
  });
}

// ── Blocks ───────────────────────────────────────────────────────────────────

export function findBlock(blockerId: string, blockedId: string): Promise<Block | null> {
  return prisma.block.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
  });
}

export function findBlockBetween(a: string, b: string): Promise<Block | null> {
  return prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
}

export type BlockWithUser = Block & { blocked: User };

export function listBlocks(blockerId: string): Promise<BlockWithUser[]> {
  return prisma.block.findMany({
    where: { blockerId },
    include: { blocked: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Ids of everyone in a block with this user, in either direction. */
export async function blockedEitherWayIds(userId: string): Promise<string[]> {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  return rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId));
}

/**
 * Creates the block and cancels any pending request between the pair in the
 * same transaction (§10.2: "any pending request between them is cancelled").
 */
export function createBlock(blockerId: string, blockedId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    await tx.friendRequest.updateMany({
      where: {
        status: 'pending',
        OR: [
          { fromUserId: blockerId, toUserId: blockedId },
          { fromUserId: blockedId, toUserId: blockerId },
        ],
      },
      data: { status: 'cancelled' },
    });
  });
}

export async function deleteBlock(blockerId: string, blockedId: string): Promise<boolean> {
  const result = await prisma.block.deleteMany({ where: { blockerId, blockedId } });
  return result.count > 0;
}

// ── Close friends (§24.12) ───────────────────────────────────────────────────

export type CloseFriendWithUser = CloseFriend & { friend: User };

export function listCloseFriends(ownerId: string): Promise<CloseFriendWithUser[]> {
  return prisma.closeFriend.findMany({
    where: { ownerId },
    include: { friend: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Every close-friend id of one owner — used by the status audience check. */
export async function closeFriendIds(ownerId: string): Promise<string[]> {
  const rows = await prisma.closeFriend.findMany({
    where: { ownerId },
    select: { friendId: true },
  });
  return rows.map((r) => r.friendId);
}

export function addCloseFriend(ownerId: string, friendId: string): Promise<CloseFriend> {
  return prisma.closeFriend.upsert({
    where: { ownerId_friendId: { ownerId, friendId } },
    create: { ownerId, friendId },
    update: {},
  });
}

export async function removeCloseFriend(ownerId: string, friendId: string): Promise<boolean> {
  const result = await prisma.closeFriend.deleteMany({ where: { ownerId, friendId } });
  return result.count > 0;
}

/**
 * Of the given authors, which ones have `viewerId` on *their* close-friends
 * list — the reverse direction from `closeFriendIds` (used by the status/live
 * audience check, batched across a whole feed instead of one query per row).
 */
export async function authorsWhoCloseFriended(
  viewerId: string,
  authorIds: string[],
): Promise<string[]> {
  if (authorIds.length === 0) return [];
  const rows = await prisma.closeFriend.findMany({
    where: { friendId: viewerId, ownerId: { in: authorIds } },
    select: { ownerId: true },
  });
  return rows.map((r) => r.ownerId);
}
