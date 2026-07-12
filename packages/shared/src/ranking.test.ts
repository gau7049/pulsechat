import { describe, expect, it } from 'vitest';
import { computeRankingScore } from './ranking.js';

const NOW = new Date('2026-07-12T00:00:00Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

describe('computeRankingScore', () => {
  it('scores likes higher than comments, and comments higher than views', () => {
    const base = { likeCount: 0, commentCount: 0, viewCount: 0, createdAt: hoursAgo(24) };
    const oneLike = computeRankingScore({ ...base, likeCount: 1 }, NOW);
    const oneComment = computeRankingScore({ ...base, commentCount: 1 }, NOW);
    const oneView = computeRankingScore({ ...base, viewCount: 1 }, NOW);
    expect(oneLike).toBeGreaterThan(oneComment);
    expect(oneComment).toBeGreaterThan(oneView);
  });

  it('is zero for a brand-new post with no engagement', () => {
    expect(
      computeRankingScore({ likeCount: 0, commentCount: 0, viewCount: 0, createdAt: NOW }, NOW),
    ).toBe(0);
  });

  it('decays view contribution with age (average views per day)', () => {
    const recent = computeRankingScore(
      { likeCount: 0, commentCount: 0, viewCount: 100, createdAt: hoursAgo(24) },
      NOW,
    );
    const old = computeRankingScore(
      { likeCount: 0, commentCount: 0, viewCount: 100, createdAt: hoursAgo(24 * 10) },
      NOW,
    );
    expect(recent).toBeGreaterThan(old);
  });

  it('does not divide by (near) zero for a just-created post', () => {
    const score = computeRankingScore(
      { likeCount: 0, commentCount: 0, viewCount: 10, createdAt: NOW },
      NOW,
    );
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it('accepts createdAt as an ISO string', () => {
    const score = computeRankingScore(
      { likeCount: 2, commentCount: 1, viewCount: 5, createdAt: hoursAgo(24).toISOString() },
      NOW,
    );
    expect(score).toBeGreaterThan(0);
  });
});
