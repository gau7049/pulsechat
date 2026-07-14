import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

/**
 * Social graph contracts (Requirement Scope §9–10, Technical Spec §8):
 * search, friend requests, friends, suggestions, blocks, invites, and the
 * public profile view.
 */

/** How the requesting user relates to another user; drives every action button. */
export const RELATIONSHIPS = [
  'self',
  'none',
  'friends',
  /** They sent the viewer a pending request. */
  'incoming_pending',
  /** The viewer sent them a pending request. */
  'outgoing_pending',
  /** The viewer blocked them. (Users who blocked the viewer are never surfaced.) */
  'blocked',
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** GET /search/users — username or display name, privacy + block filtered (§9). */
export const userSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1, 'Type something to search').max(50),
});
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;

/** POST /friend-requests (§10). */
export const sendFriendRequestSchema = z.object({
  toUserId: z.string().uuid(),
});
export type SendFriendRequestBody = z.infer<typeof sendFriendRequestSchema>;

/**
 * PATCH /friend-requests/:id — accept/reject are the recipient's moves,
 * cancel is the sender's (§10).
 */
export const respondFriendRequestSchema = z.object({
  action: z.enum(['accept', 'reject', 'cancel']),
});
export type RespondFriendRequestBody = z.infer<typeof respondFriendRequestSchema>;

/** GET /friend-requests — pending only, one direction at a time. */
export const friendRequestListQuerySchema = paginationQuerySchema.extend({
  direction: z.enum(['incoming', 'outgoing']).default('incoming'),
});
export type FriendRequestListQuery = z.infer<typeof friendRequestListQuerySchema>;

/** POST /blocks (§10.2). */
export const blockUserSchema = z.object({
  userId: z.string().uuid(),
});
export type BlockUserBody = z.infer<typeof blockUserSchema>;

/** The minimal public card shown anywhere a user is listed. */
export interface UserSummaryDto {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** One row of GET /search/users. */
export interface SearchResultDto extends UserSummaryDto {
  relationship: Relationship;
  /** False when their privacy (who-can-send-requests) rules the viewer out. */
  canSendRequest: boolean;
  /** Set when relationship is a pending request, so it can be acted on inline. */
  requestId: string | null;
}

export interface FriendRequestDto {
  id: string;
  direction: 'incoming' | 'outgoing';
  /** The other party — sender for incoming, recipient for outgoing. */
  user: UserSummaryDto;
  createdAt: string;
}

export interface FriendDto {
  user: UserSummaryDto;
  friendsSince: string;
  /**
   * The friend's X25519 public key — needed to wrap conversation content keys
   * when starting a chat with them (Technical Spec §6). Null until they have
   * registered a key (e.g. seeded demo accounts).
   */
  publicKey: string | null;
}

/** "People you may know" — ranked by shared friends (§10.1). */
export interface SuggestionDto {
  user: UserSummaryDto;
  mutualCount: number;
}

export interface BlockedUserDto {
  user: UserSummaryDto;
  blockedAt: string;
}

/** §24.12 close friends list — a private story-audience tier, not a friendship itself. */
export interface CloseFriendDto {
  user: UserSummaryDto;
  addedAt: string;
}

/** POST /invites — the caller's shareable invite code (§10.3). */
export interface InviteDto {
  code: string;
}

/** GET /invites/:code — who the invite belongs to, for the landing page. */
export interface InviteLookupDto {
  inviter: UserSummaryDto;
}

/**
 * GET /users/:username. `details` and `stats` are null when the viewer is not
 * allowed past the minimal card (§8 visibility levels).
 */
export interface PublicProfileDto {
  user: UserSummaryDto;
  visibility: 'public' | 'friends' | 'private';
  relationship: Relationship;
  canSendRequest: boolean;
  requestId: string | null;
  details: {
    bio: string | null;
    country: string | null;
    state: string | null;
    /** Only when the owner made it visible (§8). */
    email: string | null;
    /** Only when the owner made it visible (§8). */
    birthDate: string | null;
    memberSince: string;
  } | null;
  stats: {
    posts: number;
    friends: number;
    /** Pending sent friend requests — the third Instagram-style stat (§13.4). */
    pendingSent: number;
  } | null;
  /** Shared friends with the viewer; absent on own profile. */
  mutualCount?: number;
}
