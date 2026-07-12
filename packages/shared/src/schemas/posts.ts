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

/** POST /posts — media is required (one image per post, no carousel, per schema). */
export const createPostSchema = z.object({
  mediaUrl: z.string().url().max(2048),
  caption: z.string().trim().max(CAPTION_MAX).optional(),
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
  mediaUrl: string;
  caption: string | null;
  /** Extracted from the caption at creation time (§13.1); empty for non-public authors. */
  hashtags: string[];
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
  createdAt: string;
}
