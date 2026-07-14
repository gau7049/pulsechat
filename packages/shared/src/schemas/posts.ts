import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import type { UserSummaryDto } from './social.js';

/**
 * Posts & feed contracts (Requirement Scope §13). Unlike `Message`, posts are
 * not end-to-end encrypted (Technical Spec §6 scopes encryption to messages
 * only) — caption/body are plain, server-visible text.
 */

const CAPTION_MAX = 2200;
const COMMENT_MAX = 1000;
const MAX_TAGGED_USERS = 20;

/** §24.7 per-post visibility override — never looser than the account-level Visibility (§8). */
export const postAudienceSchema = z.enum(['everyone', 'friends', 'only_me']);
export type PostAudience = z.infer<typeof postAudienceSchema>;

/**
 * POST /posts — one image per post, no carousel, but §24.1 relaxes media
 * from required to optional: a post needs a media URL, a caption, or both.
 */
export const createPostSchema = z
  .object({
    mediaUrl: z.string().url().max(2048).optional(),
    caption: z.string().trim().max(CAPTION_MAX).optional(),
    /** Defaults from the author's account-level visibility when omitted (§24.7). */
    audience: postAudienceSchema.optional(),
    /** §24.2 tag picker — friends-only, enforced server-side. */
    taggedUserIds: z.array(z.string().uuid()).max(MAX_TAGGED_USERS).optional(),
  })
  .refine((body) => Boolean(body.mediaUrl) || Boolean(body.caption?.trim()), {
    message: 'Add a photo or write a caption',
    path: ['caption'],
  });
export type CreatePostBody = z.infer<typeof createPostSchema>;

/** POST /posts/:id/comments */
export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(COMMENT_MAX),
});
export type CreateCommentBody = z.infer<typeof createCommentSchema>;

/** Every list endpoint here shares the standard cursor+limit contract. */
export const postsQuerySchema = paginationQuerySchema;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface PostDto {
  id: string;
  author: UserSummaryDto;
  /** Nullable since §24.1 — a text-only post has no media. */
  mediaUrl: string | null;
  caption: string | null;
  audience: PostAudience;
  /** Extracted from the caption at creation time (§13.1); empty for non-public authors. */
  hashtags: string[];
  /** §24.2 tagged users — distinct from @mentions parsed out of the caption text. */
  taggedUsers: UserSummaryDto[];
  likeCount: number;
  commentCount: number;
  viewCount: number;
  /** Per-viewer state — never true for someone else's like/save. */
  likedByMe: boolean;
  savedByMe: boolean;
  createdAt: string;
}

export interface CommentDto {
  id: string;
  postId: string;
  user: UserSummaryDto;
  body: string;
  /** §24.6 comment likes. */
  likeCount: number;
  likedByMe: boolean;
  createdAt: string;
}

// ── Discovery — trending movies & songs (§24.3) ─────────────────────────────

export const discoverQuerySchema = paginationQuerySchema;
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

export interface TrendingMovieDto {
  id: string;
  title: string;
  posterUrl: string | null;
  overview: string | null;
}

export interface TrendingSongDto {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  previewUrl: string | null;
}
