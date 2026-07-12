import { prisma } from '../lib/prisma.js';
import { activeCount } from './presence.service.js';

/**
 * Admin analytics dashboard (Requirement Scope §18.1, Technical Spec §13):
 * reads only AnalyticsEvent aggregates and User.createdAt — schema-level, no
 * query path to Message.ciphertext exists from this file.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 90;

export interface AdminAnalyticsSummary {
  totalUsers: number;
  activeNow: number;
  dau: number;
  wau: number;
}

export async function getSummary(): Promise<AdminAnalyticsSummary> {
  const now = Date.now();
  const [totalUsers, activeNow, dau, wau] = await Promise.all([
    prisma.user.count(),
    activeCount('', 'all'),
    countDistinctUsers('session_start', new Date(now - DAY_MS)),
    countDistinctUsers('session_start', new Date(now - 7 * DAY_MS)),
  ]);
  return { totalUsers, activeNow, dau, wau };
}

async function countDistinctUsers(eventType: string, since: Date): Promise<number> {
  const rows = await prisma.analyticsEvent.findMany({
    where: { eventType, createdAt: { gte: since }, userId: { not: null } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return rows.length;
}

export interface TimeseriesPoint {
  date: string;
  count: number;
}

/** Bucketed by day in-memory over a bounded window (mirrors §13.2's ranking trade-off). */
export async function getTimeseries(
  metric: 'signups' | 'sessions',
  rangeDays: number,
): Promise<TimeseriesPoint[]> {
  const days = Math.min(rangeDays, MAX_RANGE_DAYS);
  const since = new Date(Date.now() - days * DAY_MS);

  const createdAts =
    metric === 'signups'
      ? (
          await prisma.user.findMany({
            where: { createdAt: { gte: since } },
            select: { createdAt: true },
          })
        ).map((r) => r.createdAt)
      : (
          await prisma.analyticsEvent.findMany({
            where: { eventType: 'session_start', createdAt: { gte: since } },
            select: { createdAt: true },
          })
        ).map((r) => r.createdAt);

  const buckets = new Map<string, number>();
  for (const date of createdAts) {
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}
