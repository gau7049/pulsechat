import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';
import type { UserSummaryDto } from './social.js';

/**
 * Reports & admin moderation queue (Requirement Scope §18, Technical Spec §13).
 */

export const REPORT_TARGET_TYPES = ['post', 'message', 'profile'] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const REPORT_STATUSES = ['open', 'reviewed', 'actioned'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ['warn', 'remove', 'suspend', 'dismiss'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

const REASON_MAX = 500;

/** POST /reports */
export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().min(1),
  reason: z.string().trim().min(1).max(REASON_MAX),
});
export type CreateReportBody = z.infer<typeof createReportSchema>;

/** PATCH /admin/reports/:id */
export const reportActionSchema = z.object({
  action: z.enum(REPORT_ACTIONS),
});
export type ReportActionBody = z.infer<typeof reportActionSchema>;

/** GET /admin/reports?status= */
export const adminReportsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).optional(),
});
export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;

/** PATCH /admin/users/:id/status — admin-only lever, deliberately excludes
 * deactivated/deleted, which stay self-service-only (§16 vs §18). */
export const adminSetUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});
export type AdminSetUserStatusBody = z.infer<typeof adminSetUserStatusSchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

/**
 * Admin-facing report row. Deliberately never carries message ciphertext —
 * for a message report only non-content metadata is exposed, keeping the
 * "admin cannot read chat content" guarantee (§13, §18.1) literal rather
 * than incidental.
 */
export interface ReportAdminDto {
  id: string;
  reporter: UserSummaryDto;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  preview:
    | { kind: 'post'; mediaUrl: string; caption: string | null; author: UserSummaryDto }
    | { kind: 'message'; conversationId: string; sender: UserSummaryDto }
    | { kind: 'profile'; user: UserSummaryDto }
    | null;
}
