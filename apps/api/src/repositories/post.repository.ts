import type { Comment, Like, Post, PostHashtag, Save, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access for posts, hashtags, comments, likes, and saves (Requirement
 * Scope §13). Visibility, ranking, and hashtag-extraction rules live in the
 * service layer; this layer only shapes queries (Build Instructions §6).
 */

/**
 * The only author fields any post-list view ever reads: `toUserSummaryDto`
 * (id/username/displayName/avatarUrl) plus `visibility` for `assertCanView`'s
 * gate. Narrowed via `select` rather than `include: true` so hot list
 * endpoints (feed/hashtag/explore) don't pull every `User` column —
 * `passwordHash` included — off the wire on every row (§14 "<300ms list
 * endpoints" perf note).
 */
export type AuthorSummary = Pick<
  User,
  'id' | 'username' | 'displayName' | 'avatarUrl' | 'visibility'
>;
const authorSelect = {
  id: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  visibility: true,
} as const;

export type PostWithMeta = Post & {
  author: AuthorSummary;
  hashtags: PostHashtag[];
  likes: Like[];
  saves: Save[];
};

/** Viewer-scoped `likes`/`saves` — presence, not the full join table. */
const metaInclude = (viewerId: string) => ({
  author: { select: authorSelect },
  hashtags: true,
  likes: { where: { userId: viewerId } },
  saves: { where: { userId: viewerId } },
});

// ── Posts ────────────────────────────────────────────────────────────────────

export function create(input: {
  authorId: string;
  mediaUrl: string;
  caption?: string;
  /** Already lowercased; empty when the author isn't a public profile (§13.1). */
  hashtags: string[];
}): Promise<Post> {
  return prisma.post.create({
    data: {
      authorId: input.authorId,
      mediaUrl: input.mediaUrl,
      caption: input.caption ?? null,
      hashtags: {
        create: input.hashtags.map((tag) => ({
          hashtag: { connectOrCreate: { where: { tag }, create: { tag } } },
        })),
      },
    },
  });
}

export function findById(id: string, viewerId: string): Promise<PostWithMeta | null> {
  return prisma.post.findUnique({ where: { id }, include: metaInclude(viewerId) });
}

export async function deleteById(id: string): Promise<void> {
  await prisma.post.delete({ where: { id } });
}

export async function incrementView(id: string): Promise<void> {
  await prisma.post.update({ where: { id }, data: { viewCount: { increment: 1 } } });
}

/** A user's own posts, newest first (profile grid). */
export function listByAuthor(
  authorId: string,
  viewerId: string,
  options: { cursor?: string; limit: number },
): Promise<PostWithMeta[]> {
  return prisma.post.findMany({
    where: { authorId },
    include: metaInclude(viewerId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

export type PostWithHashtags = Post & { author: AuthorSummary; hashtags: PostHashtag[] };

/**
 * Bounded recency window ranked in-memory by the service (§13.2). Per-viewer
 * like/save state isn't needed here — only the final page (after ranking +
 * offset) gets that, via `likedSavedSets`, to avoid fetching it for the
 * whole window.
 */
export function findRecentPublic(limit: number): Promise<PostWithHashtags[]> {
  return prisma.post.findMany({
    where: { author: { visibility: 'public' } },
    include: { author: { select: authorSelect }, hashtags: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function findRecentForTag(tag: string, limit: number): Promise<PostWithHashtags[]> {
  return prisma.post.findMany({
    where: { author: { visibility: 'public' }, hashtags: { some: { tag } } },
    include: { author: { select: authorSelect }, hashtags: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Per-viewer like/save state for a specific page of post ids (not the whole ranking window). */
export async function likedSavedSets(
  viewerId: string,
  postIds: string[],
): Promise<{ liked: Set<string>; saved: Set<string> }> {
  if (postIds.length === 0) return { liked: new Set(), saved: new Set() };
  const [likes, saves] = await Promise.all([
    prisma.like.findMany({ where: { userId: viewerId, postId: { in: postIds } } }),
    prisma.save.findMany({ where: { userId: viewerId, postId: { in: postIds } } }),
  ]);
  return {
    liked: new Set(likes.map((l) => l.postId)),
    saved: new Set(saves.map((s) => s.postId)),
  };
}

// ── Likes & saves ────────────────────────────────────────────────────────────

/** Toggle + transactional counter (§13.5); returns the new state. */
export async function toggleLike(postId: string, userId: string): Promise<boolean> {
  const existing = await prisma.like.findUnique({ where: { postId_userId: { postId, userId } } });
  if (existing) {
    await prisma.$transaction([
      prisma.like.delete({ where: { postId_userId: { postId, userId } } }),
      prisma.post.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } }),
    ]);
    return false;
  }
  await prisma.$transaction([
    prisma.like.create({ data: { postId, userId } }),
    prisma.post.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } }),
  ]);
  return true;
}

/** Private bookmark toggle — no counter on the Post row (§13.5). */
export async function toggleSave(postId: string, userId: string): Promise<boolean> {
  const existing = await prisma.save.findUnique({ where: { postId_userId: { postId, userId } } });
  if (existing) {
    await prisma.save.delete({ where: { postId_userId: { postId, userId } } });
    return false;
  }
  await prisma.save.create({ data: { postId, userId } });
  return true;
}

export type LikeWithPost = Like & { post: PostWithMeta };

export function listLiked(
  userId: string,
  options: { cursorPostId?: string; limit: number },
): Promise<LikeWithPost[]> {
  return prisma.like.findMany({
    where: { userId },
    include: { post: { include: metaInclude(userId) } },
    orderBy: [{ createdAt: 'desc' }, { postId: 'asc' }],
    take: options.limit,
    ...(options.cursorPostId
      ? { cursor: { postId_userId: { postId: options.cursorPostId, userId } }, skip: 1 }
      : {}),
  });
}

export type SaveWithPost = Save & { post: PostWithMeta };

export function listSaved(
  userId: string,
  options: { cursorPostId?: string; limit: number },
): Promise<SaveWithPost[]> {
  return prisma.save.findMany({
    where: { userId },
    include: { post: { include: metaInclude(userId) } },
    orderBy: [{ createdAt: 'desc' }, { postId: 'asc' }],
    take: options.limit,
    ...(options.cursorPostId
      ? { cursor: { postId_userId: { postId: options.cursorPostId, userId } }, skip: 1 }
      : {}),
  });
}

// ── Comments ─────────────────────────────────────────────────────────────────

export type CommentWithUser = Comment & { user: User };

export async function createComment(
  postId: string,
  userId: string,
  body: string,
): Promise<Comment> {
  const [comment] = await prisma.$transaction([
    prisma.comment.create({ data: { postId, userId, body } }),
    prisma.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } }),
  ]);
  return comment;
}

/** Oldest first — a comment thread reads chronologically. */
export function listComments(
  postId: string,
  options: { cursor?: string; limit: number },
): Promise<CommentWithUser[]> {
  return prisma.comment.findMany({
    where: { postId },
    include: { user: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}
