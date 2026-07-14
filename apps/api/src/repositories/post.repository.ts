import type {
  Comment,
  CommentLike,
  Like,
  Post,
  PostAudience,
  PostHashtag,
  PostTag,
  Save,
  User,
} from '@prisma/client';
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

export type TagWithUser = PostTag & { taggedUser: AuthorSummary };

export type PostWithMeta = Post & {
  author: AuthorSummary;
  hashtags: PostHashtag[];
  tags: TagWithUser[];
  likes: Like[];
  saves: Save[];
};

/** Viewer-scoped `likes`/`saves` — presence, not the full join table. */
const metaInclude = (viewerId: string) => ({
  author: { select: authorSelect },
  hashtags: true,
  tags: { include: { taggedUser: { select: authorSelect } } },
  likes: { where: { userId: viewerId } },
  saves: { where: { userId: viewerId } },
});

// ── Posts ────────────────────────────────────────────────────────────────────

export function create(input: {
  authorId: string;
  /** §24.1 — nullable now that a post may be caption-only. */
  mediaUrl?: string;
  caption?: string;
  audience: PostAudience;
  /** Already lowercased; empty when the author isn't a public profile (§13.1). */
  hashtags: string[];
  /** Already verified as friends of the author by the service (§24.2). */
  taggedUserIds: string[];
}): Promise<Post> {
  return prisma.post.create({
    data: {
      authorId: input.authorId,
      mediaUrl: input.mediaUrl ?? null,
      caption: input.caption ?? null,
      audience: input.audience,
      hashtags: {
        create: input.hashtags.map((tag) => ({
          hashtag: { connectOrCreate: { where: { tag }, create: { tag } } },
        })),
      },
      tags: {
        create: input.taggedUserIds.map((taggedUserId) => ({ taggedUserId })),
      },
    },
  });
}

/** §24.2 self-removal of a tag — returns false if the caller wasn't tagged. */
export async function deleteTag(postId: string, taggedUserId: string): Promise<boolean> {
  const result = await prisma.postTag.deleteMany({ where: { postId, taggedUserId } });
  return result.count > 0;
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
  options: { cursor?: string; limit: number; audienceIn?: PostAudience[] },
): Promise<PostWithMeta[]> {
  return prisma.post.findMany({
    where: { authorId, ...(options.audienceIn ? { audience: { in: options.audienceIn } } : {}) },
    include: metaInclude(viewerId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

export type PostWithHashtags = Post & {
  author: AuthorSummary;
  hashtags: PostHashtag[];
  tags: TagWithUser[];
};

const discoveryInclude = {
  author: { select: authorSelect },
  hashtags: true,
  tags: { include: { taggedUser: { select: authorSelect } } },
} as const;

/**
 * Bounded recency window ranked in-memory by the service (§13.2). Per-viewer
 * like/save state isn't needed here — only the final page (after ranking +
 * offset) gets that, via `likedSavedSets`, to avoid fetching it for the
 * whole window. §24.7: only `everyone`-audience posts surface in discovery,
 * even from a public author.
 */
export function findRecentPublic(limit: number): Promise<PostWithHashtags[]> {
  return prisma.post.findMany({
    where: { author: { visibility: 'public' }, audience: 'everyone' },
    include: discoveryInclude,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function findRecentForTag(tag: string, limit: number): Promise<PostWithHashtags[]> {
  return prisma.post.findMany({
    where: {
      author: { visibility: 'public' },
      audience: 'everyone',
      hashtags: { some: { tag } },
    },
    include: discoveryInclude,
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

export type CommentWithUser = Comment & { user: User; likes: CommentLike[] };

/** Viewer-scoped `likes` — presence, not the full join table (§24.6). */
const commentInclude = (viewerId: string) => ({
  user: true,
  likes: { where: { userId: viewerId } },
});

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
  viewerId: string,
  options: { cursor?: string; limit: number },
): Promise<CommentWithUser[]> {
  return prisma.comment.findMany({
    where: { postId },
    include: commentInclude(viewerId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: options.limit,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
}

export type CommentWithPost = Comment & { post: PostWithMeta };

/** Loads a comment plus its post's visibility context, for the like/notify path (§24.6). */
export function findCommentWithPost(commentId: string): Promise<CommentWithPost | null> {
  return prisma.comment.findUnique({
    where: { id: commentId },
    include: { post: { include: metaInclude('') } },
  }) as Promise<CommentWithPost | null>;
}

/** Toggle + transactional counter (§24.6); returns the new state. */
export async function toggleCommentLike(commentId: string, userId: string): Promise<boolean> {
  const existing = await prisma.commentLike.findUnique({
    where: { commentId_userId: { commentId, userId } },
  });
  if (existing) {
    await prisma.$transaction([
      prisma.commentLike.delete({ where: { commentId_userId: { commentId, userId } } }),
      prisma.comment.update({ where: { id: commentId }, data: { likeCount: { decrement: 1 } } }),
    ]);
    return false;
  }
  await prisma.$transaction([
    prisma.commentLike.create({ data: { commentId, userId } }),
    prisma.comment.update({ where: { id: commentId }, data: { likeCount: { increment: 1 } } }),
  ]);
  return true;
}
