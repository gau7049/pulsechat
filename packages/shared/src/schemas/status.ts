import { z } from 'zod';
import { statusVisibilityEnum, type StatusVisibility } from './profile.js';
import type { UserSummaryDto } from './social.js';

/**
 * Status & live contracts (Requirement Scope §11–12, Technical Spec §4, §9).
 * Both the rail and the active-live list are bounded by friend count, so they
 * return flat arrays rather than cursor pages — the same trade-off already
 * documented for `GET /conversations`.
 */

/** §24.13 poll/question sticker, created together with the status. */
const pollOptionSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().trim().min(1).max(80),
});
export const statusPollInputSchema = z
  .object({
    kind: z.enum(['poll', 'question']),
    question: z.string().trim().min(1).max(200),
    options: z.array(pollOptionSchema).min(2).max(6).optional(),
  })
  .refine((value) => value.kind === 'question' || (value.options && value.options.length >= 2), {
    message: 'A poll needs at least two options',
    path: ['options'],
  });
export type StatusPollInput = z.infer<typeof statusPollInputSchema>;

/** POST /statuses — a status needs a photo, a caption, or both. */
export const createStatusSchema = z
  .object({
    mediaUrl: z.string().url().max(2048).optional(),
    caption: z.string().trim().max(500).optional(),
    musicTrackId: z.string().max(64).optional(),
    visibility: statusVisibilityEnum,
    poll: statusPollInputSchema.optional(),
  })
  .refine((value) => Boolean(value.mediaUrl) || Boolean(value.caption), {
    message: 'A status needs a photo or a caption',
    path: ['caption'],
  });
export type CreateStatusBody = z.infer<typeof createStatusSchema>;

/** POST /live/start. */
export const startLiveSchema = z.object({ visibility: statusVisibilityEnum });
export type StartLiveBody = z.infer<typeof startLiveSchema>;

/** POST /statuses/:id/react — toggle/replace, same semantics as message reactions. */
export const reactToStatusSchema = z.object({ emoji: z.string().trim().min(1).max(8) });
export type ReactToStatusBody = z.infer<typeof reactToStatusSchema>;

/** POST /statuses/:id/poll/respond — one of the two fields, matching the poll's kind. */
export const respondToPollSchema = z
  .object({
    selectedOptionId: z.string().min(1).max(32).optional(),
    answerText: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => Boolean(value.selectedOptionId) || Boolean(value.answerText), {
    message: 'A response needs a selected option or an answer',
  });
export type RespondToPollBody = z.infer<typeof respondToPollSchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface StatusPollOptionDto {
  id: string;
  label: string;
}

export interface StatusPollDto {
  id: string;
  kind: 'poll' | 'question';
  question: string;
  options: StatusPollOptionDto[] | null;
  /** Set once the viewer has responded (their own choice/answer only). */
  myResponse: { selectedOptionId: string | null; answerText: string | null } | null;
}

export interface StatusDto {
  id: string;
  userId: string;
  mediaUrl: string | null;
  caption: string | null;
  musicTrackId: string | null;
  visibility: StatusVisibility;
  expiresAt: string;
  createdAt: string;
  /** §24.10 reactions — the viewer's own reaction, plus a total count. */
  myReaction: string | null;
  reactionCount: number;
  /** §24.13 — present only when the author attached a poll/question sticker. */
  poll: StatusPollDto | null;
}

/** GET /statuses/:id/poll/results — author-only, shape depends on the poll kind. */
export type StatusPollResultsDto =
  | {
      kind: 'poll';
      totalResponses: number;
      options: Array<{ id: string; label: string; count: number }>;
    }
  | {
      kind: 'question';
      answers: Array<{ user: UserSummaryDto; answerText: string; createdAt: string }>;
    };

export interface LiveSessionDto {
  id: string;
  userId: string;
  visibility: StatusVisibility;
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
