import { z } from 'zod';

/**
 * Admin analytics dashboard (Requirement Scope §18.1, Technical Spec §13).
 */

export const adminTimeseriesQuerySchema = z.object({
  metric: z.enum(['signups', 'sessions']),
  range: z.coerce
    .number()
    .int()
    .refine((v) => [7, 30, 90].includes(v), {
      message: 'range must be 7, 30, or 90',
    }),
});
export type AdminTimeseriesQuery = z.infer<typeof adminTimeseriesQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface AdminAnalyticsSummaryDto {
  totalUsers: number;
  activeNow: number;
  dau: number;
  wau: number;
}

export interface TimeseriesPointDto {
  date: string;
  count: number;
}
