import { z } from 'zod';
import { paginationQuerySchema } from './pagination.js';

/**
 * In-app notifications + Web Push (Technical Spec §12, Requirement Scope §17).
 */

export const notificationsQuerySchema = paginationQuerySchema;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

/** POST /push/subscribe — the browser PushSubscription object, verbatim. */
export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
});
export type PushSubscribeBody = z.infer<typeof pushSubscribeSchema>;

/** DELETE /push/subscribe?endpoint= */
export const pushUnsubscribeQuerySchema = z.object({
  endpoint: z.string().url().max(2048),
});
export type PushUnsubscribeQuery = z.infer<typeof pushUnsubscribeQuerySchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface NotificationDto {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
