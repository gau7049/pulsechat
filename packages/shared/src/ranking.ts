/**
 * Hashtag/explore ranking (Requirement Scope §13.2): "a combined score of
 * likes, comments, and average views… computed at read time." The view term
 * is literally an average (views ÷ age in days), which also gives the score
 * a recency decay so an old, heavily-viewed post doesn't permanently
 * outrank fresh engagement.
 */

export const RANKING_WEIGHTS = {
  like: 3,
  comment: 2,
  avgViewsPerDay: 1,
} as const;

/** Floors the age denominator at one hour so a brand-new post doesn't divide by ~0. */
const MIN_AGE_DAYS = 1 / 24;

export interface PostEngagement {
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createdAt: Date | string;
}

export function computeRankingScore(post: PostEngagement, now: Date = new Date()): number {
  const createdAt = typeof post.createdAt === 'string' ? new Date(post.createdAt) : post.createdAt;
  const ageDays = Math.max(
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24),
    MIN_AGE_DAYS,
  );
  const avgViewsPerDay = post.viewCount / ageDays;
  return (
    post.likeCount * RANKING_WEIGHTS.like +
    post.commentCount * RANKING_WEIGHTS.comment +
    avgViewsPerDay * RANKING_WEIGHTS.avgViewsPerDay
  );
}
