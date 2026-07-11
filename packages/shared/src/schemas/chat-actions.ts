import { z } from 'zod';
import { LIMITS } from '../constants.js';
import type { MessageDto } from './chat.js';

/**
 * Message actions & conversation management (Requirement Scope §14.3–14.11).
 * Content stays ciphertext: edit carries re-encrypted bytes, reactions carry a
 * bare emoji (reactions are metadata, not message content).
 */

const base64 = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64');

/** PATCH /messages/:id — the sender re-encrypts the edited body (§14.3). */
export const editMessageSchema = z.object({
  ciphertext: base64(LIMITS.MESSAGE_CIPHERTEXT_MAX_CHARS),
  nonce: base64(64),
});
export type EditMessageBody = z.infer<typeof editMessageSchema>;

/** DELETE /messages/:id?scope= — for me hides; for everyone tombstones (§14.3). */
export const deleteMessageQuerySchema = z.object({
  scope: z.enum(['me', 'everyone']).default('me'),
});
export type DeleteMessageQuery = z.infer<typeof deleteMessageQuerySchema>;

/**
 * POST /messages/:id/reactions — toggle semantics (§14.4): same emoji removes,
 * a different one replaces (one reaction per user per message by schema).
 */
export const reactionSchema = z.object({
  emoji: z.string().min(1).max(16),
});
export type ReactionBody = z.infer<typeof reactionSchema>;

/** PATCH /conversations/:id — per-member management flags (§14.11). */
export const conversationSettingsSchema = z
  .object({
    pinned: z.boolean(),
    muted: z.boolean(),
    archived: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' });
export type ConversationSettingsBody = z.infer<typeof conversationSettingsSchema>;

/** One reaction as it rides on a message DTO and the live event. */
export interface ReactionDto {
  userId: string;
  emoji: string;
}

/** message:reaction — emoji null means the user removed their reaction. */
export interface ReactionEventPayload {
  conversationId: string;
  messageId: string;
  userId: string;
  emoji: string | null;
}

/** message:deleted — tombstone broadcast (§14.3). */
export interface MessageDeletedPayload {
  conversationId: string;
  messageId: string;
}

/** GET /messages/starred (§14.6) — private to the caller. */
export interface StarredMessageDto {
  /** The message as the caller may see it (own aggregate omitted). */
  message: MessageDto;
  starredAt: string;
  /** Server-computable context label: group name or the other side's name. */
  conversationLabel: string;
}
