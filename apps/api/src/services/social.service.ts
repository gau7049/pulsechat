import {
  LIMITS,
  type BlockedUserDto,
  type FriendDto,
  type FriendRequestDto,
  type Page,
  type PublicProfileDto,
  type Relationship,
  type SearchResultDto,
  type SuggestionDto,
  type UserSearchQuery,
} from '@pulsechat/shared';
import { logger } from '../lib/logger.js';
import * as social from '../repositories/social.repository.js';
import * as users from '../repositories/user.repository.js';
import type { UserWithPrivacy } from '../repositories/user.repository.js';
import { AppError } from '../http/errors.js';
import { notify } from './notification.service.js';
import { toUserSummaryDto } from './user-summary.serializer.js';

/**
 * Social-graph business rules (Requirement Scope §9–10): who can find whom,
 * who can send requests to whom, and how blocking silences all of it.
 */

const SUGGESTION_LIMIT = 10;

// ── Relationship computation ─────────────────────────────────────────────────

interface RelationshipInfo {
  relationship: Relationship;
  canSendRequest: boolean;
  requestId: string | null;
}

/**
 * Batch-resolves the viewer's relationship to a page of candidates using a
 * fixed number of queries regardless of page size.
 */
async function relationshipMap(
  viewerId: string,
  candidates: UserWithPrivacy[],
): Promise<Map<string, RelationshipInfo>> {
  const candidateIds = candidates.map((c) => c.id);
  const [viewerFriendIds, pending, blockedIds] = await Promise.all([
    social.friendIds(viewerId),
    social.pendingWithUsers(viewerId, candidateIds),
    social.blockedEitherWayIds(viewerId),
  ]);
  const friendSet = new Set(viewerFriendIds);
  const blockedSet = new Set(blockedIds);
  const mutualCounts = await mutualCountsFor(viewerFriendIds, candidateIds);

  const map = new Map<string, RelationshipInfo>();
  for (const candidate of candidates) {
    const pendingRow = pending.find(
      (p) => p.fromUserId === candidate.id || p.toUserId === candidate.id,
    );
    let relationship: Relationship = 'none';
    if (candidate.id === viewerId) relationship = 'self';
    else if (blockedSet.has(candidate.id)) relationship = 'blocked';
    else if (friendSet.has(candidate.id)) relationship = 'friends';
    else if (pendingRow) {
      relationship = pendingRow.fromUserId === viewerId ? 'outgoing_pending' : 'incoming_pending';
    }
    map.set(candidate.id, {
      relationship,
      canSendRequest:
        relationship === 'none' &&
        allowsRequestFrom(candidate, (mutualCounts.get(candidate.id) ?? 0) > 0),
      requestId: pendingRow?.id ?? null,
    });
  }
  return map;
}

/** §8 "who can send friend requests": public = anyone, friends = friends of friends. */
function allowsRequestFrom(target: UserWithPrivacy, hasMutualFriend: boolean): boolean {
  const setting = target.privacy?.whoCanSendRequests ?? 'public';
  if (setting === 'public') return true;
  if (setting === 'friends') return hasMutualFriend;
  return false;
}

/** Mutual-friend counts between the viewer (via their friend ids) and candidates. */
async function mutualCountsFor(
  viewerFriendIds: string[],
  candidateIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (viewerFriendIds.length === 0 || candidateIds.length === 0) return counts;
  const friendSet = new Set(viewerFriendIds);
  const candidateSet = new Set(candidateIds);
  const rows = await social.friendshipsOfUsers(viewerFriendIds);
  for (const row of rows) {
    // A friendship between one of my friends and a candidate is one mutual.
    if (friendSet.has(row.userAId) && candidateSet.has(row.userBId)) {
      counts.set(row.userBId, (counts.get(row.userBId) ?? 0) + 1);
    } else if (friendSet.has(row.userBId) && candidateSet.has(row.userAId)) {
      counts.set(row.userAId, (counts.get(row.userAId) ?? 0) + 1);
    }
  }
  return counts;
}

// ── Search (§9) ──────────────────────────────────────────────────────────────

export async function searchUsers(
  viewerId: string,
  query: UserSearchQuery,
): Promise<Page<SearchResultDto>> {
  // Users in a block with the viewer are invisible in search, both ways (§10.2).
  const blockedIds = await social.blockedEitherWayIds(viewerId);
  const rows = await users.searchActiveUsers({
    q: query.q,
    excludeIds: [viewerId, ...blockedIds],
    cursorUsername: query.cursor,
    limit: query.limit + 1,
  });
  const pageRows = rows.slice(0, query.limit);
  const relationships = await relationshipMap(viewerId, pageRows);
  return {
    items: pageRows.map((user) => ({
      ...toUserSummaryDto(user),
      ...relationships.get(user.id)!,
    })),
    ...(rows.length > query.limit ? { nextCursor: pageRows.at(-1)!.username } : {}),
  };
}

// ── Friend requests (§10) ────────────────────────────────────────────────────

function toRequestDto(
  request: social.FriendRequestWithUsers,
  direction: 'incoming' | 'outgoing',
): FriendRequestDto {
  return {
    id: request.id,
    direction,
    user: toUserSummaryDto(direction === 'incoming' ? request.fromUser : request.toUser),
    createdAt: request.createdAt.toISOString(),
  };
}

export async function sendFriendRequest(
  fromUserId: string,
  toUserId: string,
  options: { viaInvite?: boolean } = {},
): Promise<{ id: string }> {
  if (fromUserId === toUserId) {
    throw new AppError('VALIDATION_FAILED', 'You cannot send yourself a friend request');
  }
  const [sender, target] = await Promise.all([
    users.findById(fromUserId),
    users.findById(toUserId),
  ]);
  if (!sender || !target || target.status !== 'active') {
    throw new AppError('NOT_FOUND', 'User not found');
  }

  const block = await social.findBlockBetween(fromUserId, toUserId);
  if (block?.blockerId === toUserId) {
    // They blocked the sender — stay untraceable (§10.2), report as missing.
    throw new AppError('NOT_FOUND', 'User not found');
  }
  if (block) {
    throw new AppError('CONFLICT', 'Unblock this user before sending a friend request');
  }

  if (await social.findFriendship(fromUserId, toUserId)) {
    throw new AppError('CONFLICT', 'You are already friends');
  }
  const pending = await social.findPendingBetween(fromUserId, toUserId);
  if (pending) {
    throw new AppError(
      'CONFLICT',
      pending.fromUserId === fromUserId
        ? 'You already have a pending request to this user'
        : 'This user already sent you a friend request — accept it instead',
    );
  }

  // Their own invite link implies consent, so privacy is not re-checked (§10.3).
  if (!options.viaInvite) {
    const mutuals = await mutualCountsFor(await social.friendIds(fromUserId), [toUserId]);
    if (!allowsRequestFrom(target, (mutuals.get(toUserId) ?? 0) > 0)) {
      throw new AppError('FORBIDDEN', 'This user is not accepting friend requests from you');
    }
  }

  if ((await social.countPendingOutgoing(fromUserId)) >= LIMITS.MAX_PENDING_FRIEND_REQUESTS) {
    throw new AppError(
      'CONFLICT',
      `You can have at most ${LIMITS.MAX_PENDING_FRIEND_REQUESTS} pending sent requests`,
    );
  }

  const request = await social.createRequest(fromUserId, toUserId);
  logger.info(
    { event: 'social.request_sent', fromUserId, toUserId, requestId: request.id },
    'friend request sent',
  );
  await notify(toUserId, 'friend_request', {
    from: toUserSummaryDto(sender),
    requestId: request.id,
  });
  return { id: request.id };
}

export async function respondToRequest(
  userId: string,
  requestId: string,
  action: 'accept' | 'reject' | 'cancel',
): Promise<void> {
  const request = await social.findRequestById(requestId);
  if (!request || (request.fromUserId !== userId && request.toUserId !== userId)) {
    throw new AppError('NOT_FOUND', 'Friend request not found');
  }
  const requiredRole = action === 'cancel' ? request.fromUserId : request.toUserId;
  if (userId !== requiredRole) {
    throw new AppError(
      'FORBIDDEN',
      action === 'cancel'
        ? 'Only the sender can cancel a request'
        : 'Only the recipient can respond',
    );
  }
  if (request.status !== 'pending') {
    throw new AppError('CONFLICT', 'This request has already been resolved');
  }

  if (action === 'accept') {
    await social.acceptRequest(request.id, request.fromUserId, request.toUserId);
    await notify(request.fromUserId, 'friend_accept', {
      from: toUserSummaryDto(request.toUser),
    });
  } else {
    await social.setRequestStatus(request.id, action === 'reject' ? 'rejected' : 'cancelled');
  }
  logger.info({ event: `social.request_${action}`, requestId, userId }, 'friend request resolved');
}

export async function listRequests(
  userId: string,
  direction: 'incoming' | 'outgoing',
  pagination: { cursor?: string; limit: number },
): Promise<Page<FriendRequestDto>> {
  const rows = await social.listPending(userId, direction, {
    cursor: pagination.cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  return {
    items: pageRows.map((row) => toRequestDto(row, direction)),
    ...(rows.length > pagination.limit ? { nextCursor: pageRows.at(-1)!.id } : {}),
  };
}

// ── Friends ──────────────────────────────────────────────────────────────────

export async function listFriends(
  userId: string,
  pagination: { cursor?: string; limit: number },
): Promise<Page<FriendDto>> {
  const blockedIds = await social.blockedEitherWayIds(userId);
  const cursor = decodeFriendCursor(pagination.cursor);
  const rows = await social.listFriendships(userId, {
    excludeIds: blockedIds,
    cursor,
    limit: pagination.limit + 1,
  });
  const pageRows = rows.slice(0, pagination.limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map((row) => ({
      user: toUserSummaryDto(row.userAId === userId ? row.userB : row.userA),
      friendsSince: row.createdAt.toISOString(),
    })),
    ...(rows.length > pagination.limit ? { nextCursor: `${last!.userAId}_${last!.userBId}` } : {}),
  };
}

function decodeFriendCursor(
  cursor: string | undefined,
): { userAId: string; userBId: string } | undefined {
  if (!cursor) return undefined;
  const [userAId, userBId] = cursor.split('_');
  if (!userAId || !userBId) {
    throw new AppError('VALIDATION_FAILED', 'Invalid cursor');
  }
  return { userAId, userBId };
}

export async function removeFriend(userId: string, otherUserId: string): Promise<void> {
  const removed = await social.deleteFriendship(userId, otherUserId);
  if (!removed) throw new AppError('NOT_FOUND', 'You are not friends with this user');
  logger.info({ event: 'social.friend_removed', userId, otherUserId }, 'friendship removed');
}

// ── Suggestions (§10.1) ──────────────────────────────────────────────────────

/** "People you may know": friends of friends ranked by shared-friend count. */
export async function suggestions(userId: string): Promise<SuggestionDto[]> {
  const friendIds = await social.friendIds(userId);
  if (friendIds.length === 0) return [];

  const [rows, blockedIds, pendingIds] = await Promise.all([
    social.friendshipsOfUsers(friendIds),
    social.blockedEitherWayIds(userId),
    social.pendingUserIds(userId),
  ]);
  const excluded = new Set([userId, ...friendIds, ...blockedIds, ...pendingIds]);
  const counts = new Map<string, number>();
  const friendSet = new Set(friendIds);
  for (const row of rows) {
    for (const [a, b] of [
      [row.userAId, row.userBId],
      [row.userBId, row.userAId],
    ] as const) {
      if (friendSet.has(a) && !excluded.has(b)) counts.set(b, (counts.get(b) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, SUGGESTION_LIMIT);
  const candidates = await users.findManyByIds(ranked.map(([id]) => id));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return ranked
    .filter(([id]) => byId.has(id))
    .map(([id, mutualCount]) => ({
      user: toUserSummaryDto(byId.get(id)!),
      mutualCount,
    }));
}

// ── Blocks (§10.2) ───────────────────────────────────────────────────────────

export async function blockUser(blockerId: string, targetId: string): Promise<void> {
  if (blockerId === targetId) {
    throw new AppError('VALIDATION_FAILED', 'You cannot block yourself');
  }
  const target = await users.findById(targetId);
  if (!target) throw new AppError('NOT_FOUND', 'User not found');
  await social.createBlock(blockerId, targetId);
  logger.info({ event: 'social.blocked', blockerId, targetId }, 'user blocked');
}

export async function unblockUser(blockerId: string, targetId: string): Promise<void> {
  const removed = await social.deleteBlock(blockerId, targetId);
  if (!removed) throw new AppError('NOT_FOUND', 'You have not blocked this user');
  logger.info({ event: 'social.unblocked', blockerId, targetId }, 'user unblocked');
}

export async function listBlocked(userId: string): Promise<BlockedUserDto[]> {
  const rows = await social.listBlocks(userId);
  return rows.map((row) => ({
    user: toUserSummaryDto(row.blocked),
    blockedAt: row.createdAt.toISOString(),
  }));
}

// ── Public profile (§7–8) ────────────────────────────────────────────────────

export async function getPublicProfile(
  viewerId: string,
  username: string,
): Promise<PublicProfileDto> {
  const user = await users.findByUsername(username);
  if (!user || user.status !== 'active') throw new AppError('NOT_FOUND', 'User not found');

  const isSelf = user.id === viewerId;
  if (!isSelf) {
    const block = await social.findBlockBetween(viewerId, user.id);
    if (block?.blockerId === user.id) {
      // Blocked viewers cannot see the profile at all, even a public one (§10.2).
      throw new AppError('NOT_FOUND', 'User not found');
    }
  }

  const relationships = await relationshipMap(viewerId, [user]);
  const info = relationships.get(user.id)!;
  const canSeeDetails = isSelf || user.visibility === 'public' || info.relationship === 'friends';

  const [postCount, friendCount, mutualCounts, pendingSent] = await Promise.all([
    canSeeDetails ? users.countPosts(user.id) : Promise.resolve(0),
    canSeeDetails
      ? social
          .blockedEitherWayIds(user.id)
          .then((blocked) => social.countFriendships(user.id, blocked))
      : Promise.resolve(0),
    isSelf
      ? Promise.resolve(new Map<string, number>())
      : social.friendIds(viewerId).then((ids) => mutualCountsFor(ids, [user.id])),
    canSeeDetails ? social.countPendingOutgoing(user.id) : Promise.resolve(0),
  ]);

  return {
    user: toUserSummaryDto(user),
    visibility: user.visibility,
    relationship: info.relationship,
    canSendRequest: info.canSendRequest,
    requestId: info.requestId,
    details: canSeeDetails
      ? {
          bio: user.bio,
          country: user.country,
          state: user.state,
          email: isSelf || user.privacy?.emailVisible ? user.email : null,
          birthDate:
            (isSelf || user.privacy?.birthdateVisible) && user.birthDate
              ? user.birthDate.toISOString().slice(0, 10)
              : null,
          memberSince: user.createdAt.toISOString(),
        }
      : null,
    stats: canSeeDetails
      ? {
          posts: postCount,
          friends: friendCount,
          pendingSent,
        }
      : null,
    ...(isSelf ? {} : { mutualCount: mutualCounts.get(user.id) ?? 0 }),
  };
}
