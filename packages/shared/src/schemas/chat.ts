import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { paginationQuerySchema } from './pagination.js';
import type { UserSummaryDto } from './social.js';

/**
 * Messaging contracts (Requirement Scope §14–15, §21; Technical Spec §6, §9).
 * Message content is ciphertext end to end: the server never sees plaintext,
 * so every content field here is base64 ciphertext + nonce.
 */

/** base64 (standard alphabet, with padding) — ciphertext, nonces, wrapped keys. */
const base64 = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64');

/**
 * A member's copy of the conversation content key, sealed to their X25519
 * public key client-side (Technical Spec §6).
 */
export const wrappedKeySchema = base64(LIMITS.WRAPPED_KEY_MAX_CHARS);

const conversationMemberInputSchema = z.object({
  userId: z.string().uuid(),
  wrappedKey: wrappedKeySchema,
});

/**
 * POST /conversations. `members` excludes the creator — their copy of the key
 * travels as `myWrappedKey`. Direct conversations are deduplicated server-side.
 */
export const createConversationSchema = z
  .object({
    type: z.enum(['direct', 'group']),
    name: z.string().trim().min(1).max(60).optional(),
    members: z.array(conversationMemberInputSchema).min(1).max(LIMITS.GROUP_MEMBERS_MAX),
    myWrappedKey: wrappedKeySchema,
  })
  .superRefine((value, ctx) => {
    if (value.type === 'direct') {
      if (value.members.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members'],
          message: 'A direct conversation has exactly one other member',
        });
      }
      if (value.name !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'Direct conversations are unnamed',
        });
      }
    } else {
      if (value.members.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members'],
          message: 'A group needs at least two other members',
        });
      }
      if (!value.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['name'],
          message: 'Groups need a name',
        });
      }
    }
  });
export type CreateConversationBody = z.infer<typeof createConversationSchema>;

/** POST /conversations/:id/members — the inviter wraps the key for the newcomer. */
export const addMemberSchema = conversationMemberInputSchema;
export type AddMemberBody = z.infer<typeof addMemberSchema>;

/** GET /conversations/:id/messages — cursor is a message sequence (exclusive). */
export const messagesQuerySchema = paginationQuerySchema;

// ── Socket payloads (Technical Spec §9) ──────────────────────────────────────

/** message:send — client_uuid makes retries idempotent (§21.2). */
export const messageSendSchema = z.object({
  conversationId: z.string().uuid(),
  clientUuid: z.string().uuid(),
  ciphertext: base64(LIMITS.MESSAGE_CIPHERTEXT_MAX_CHARS),
  nonce: base64(64),
  /** §14.5 reply-to — must reference a message in the same conversation. */
  replyToId: z.string().uuid().optional(),
  /** §14.5 forward — a message the sender can read; marks the copy "Forwarded". */
  forwardedFromId: z.string().uuid().optional(),
});
export type MessageSendPayload = z.infer<typeof messageSendSchema>;

/**
 * message:ack — acknowledges everything up to a sequence in one call, which
 * also covers catching up after reconnect (§21.1).
 */
export const messageAckSchema = z.object({
  conversationId: z.string().uuid(),
  upToSequence: z.number().int().min(1),
  state: z.enum(['delivered', 'read']),
});
export type MessageAckPayload = z.infer<typeof messageAckSchema>;

/** typing:start / typing:stop */
export const typingSchema = z.object({
  conversationId: z.string().uuid(),
});
export type TypingPayload = z.infer<typeof typingSchema>;

/** message:sync — replay any sequence gap per conversation on reconnect (§21.2). */
export const messageSyncSchema = z.object({
  conversations: z
    .array(
      z.object({
        conversationId: z.string().uuid(),
        lastSequence: z.number().int().min(0),
      }),
    )
    .max(100),
});
export type MessageSyncPayload = z.infer<typeof messageSyncSchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type MessageDeliveryState = 'notified' | 'delivered' | 'read';

/**
 * Sender-facing aggregate across recipients (§14.1 ticks): pending/failed are
 * client-local; the server reports sent (persisted), delivered, read.
 */
export type MessageAggregateState = 'sent' | 'delivered' | 'read';

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  nonce: string;
  sequence: number;
  clientUuid: string;
  replyToId: string | null;
  forwardedFromId: string | null;
  editedAt: string | null;
  deletedForEveryoneAt: string | null;
  createdAt: string;
  /** Everyone's reactions (§14.4); one per user by schema. */
  reactions: Array<{ userId: string; emoji: string }>;
  /** Whether the viewer starred it (§14.6) — private, per viewer. */
  starred: boolean;
  /** Only on the sender's own messages; respects read-receipt opt-outs. */
  aggregateState?: MessageAggregateState;
}

export interface ConversationMemberDto {
  user: UserSummaryDto;
  role: 'member' | 'admin';
  joinedAt: string;
  /** Presence, filtered by this member's last-seen visibility (§8). */
  online: boolean;
  lastSeenAt: string | null;
}

export interface ConversationDto {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  createdAt: string;
  members: ConversationMemberDto[];
  /** The viewer's sealed copy of the content key (Technical Spec §6). */
  myWrappedKey: string;
  lastMessage: MessageDto | null;
  unreadCount: number;
  /** §14.11 per-member management flags. */
  pinned: boolean;
  muted: boolean;
  archived: boolean;
}

/** GET /messages/:id/statuses — the §14.2 per-member breakdown, sender only. */
export interface MessageStatusDto {
  user: UserSummaryDto;
  /** null = not yet notified (offline, never reached). */
  state: MessageDeliveryState | null;
  updatedAt: string | null;
}

// ── Server → client event payloads ───────────────────────────────────────────

export interface MessageStatusEventPayload {
  conversationId: string;
  /** Who acknowledged. */
  userId: string;
  upToSequence: number;
  state: MessageDeliveryState;
}

export interface TypingEventPayload {
  conversationId: string;
  userId: string;
  displayName: string;
  typing: boolean;
}

export interface PresenceUpdatePayload {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

/** Ack returned by message:send: the persisted message or a rejection. */
export type MessageSendAck =
  { ok: true; message: MessageDto } | { ok: false; code: string; message: string };

export type MessageSyncAck =
  { ok: true; messages: MessageDto[] } | { ok: false; code: string; message: string };
