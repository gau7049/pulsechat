import { z } from 'zod';
import { statusVisibilityEnum } from './profile.js';
import type { UserSummaryDto } from './social.js';

/**
 * Status & live contracts (Requirement Scope §11–12, Technical Spec §4, §9).
 * Both the rail and the active-live list are bounded by friend count, so they
 * return flat arrays rather than cursor pages — the same trade-off already
 * documented for `GET /conversations`.
 */

/** POST /statuses — a status needs a photo, a caption, or both. */
export const createStatusSchema = z
  .object({
    mediaUrl: z.string().url().max(2048).optional(),
    caption: z.string().trim().max(500).optional(),
    musicTrackId: z.string().max(64).optional(),
    visibility: statusVisibilityEnum,
  })
  .refine((value) => Boolean(value.mediaUrl) || Boolean(value.caption), {
    message: 'A status needs a photo or a caption',
    path: ['caption'],
  });
export type CreateStatusBody = z.infer<typeof createStatusSchema>;

/** POST /live/start. */
export const startLiveSchema = z.object({ visibility: statusVisibilityEnum });
export type StartLiveBody = z.infer<typeof startLiveSchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface StatusDto {
  id: string;
  userId: string;
  mediaUrl: string | null;
  caption: string | null;
  musicTrackId: string | null;
  visibility: 'everyone' | 'friends';
  expiresAt: string;
  createdAt: string;
}

export interface LiveSessionDto {
  id: string;
  userId: string;
  visibility: 'everyone' | 'friends';
  startedAt: string;
}

/**
 * One rail entry per user with active content (§12.1): self + friends only,
 * live-having users sorted first by the service.
 */
export interface StatusFeedEntryDto {
  user: UserSummaryDto;
  statuses: StatusDto[];
  live: LiveSessionDto | null;
}

/** GET /live/active row. */
export interface LiveActiveEntryDto {
  user: UserSummaryDto;
  session: LiveSessionDto;
}
