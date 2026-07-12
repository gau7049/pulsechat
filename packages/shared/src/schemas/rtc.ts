import { z } from 'zod';
import type { UserSummaryDto } from './social.js';
import type { LiveSessionDto } from './status.js';

/**
 * WebRTC signaling contracts (Requirement Scope §12, §14.4, Technical Spec
 * §9, §11). The server never inspects SDP/ICE payloads — it only validates
 * the caller is allowed to reach the target and relays the envelope as-is.
 */

// ── Socket payloads (client → server) ────────────────────────────────────────

/** call:invite — 1:1 voice/video (§14.4), friendship-gated in the service. */
export const callInviteSchema = z.object({
  callId: z.string().uuid(),
  toUserId: z.string().uuid(),
  kind: z.enum(['audio', 'video']),
});
export type CallInvitePayload = z.infer<typeof callInviteSchema>;

/** call:accept / call:reject / call:end. */
export const callActionSchema = z.object({ callId: z.string().uuid() });
export type CallActionPayload = z.infer<typeof callActionSchema>;

/** live:join / live:leave. */
export const liveTargetSchema = z.object({ broadcasterUserId: z.string().uuid() });
export type LiveTargetPayload = z.infer<typeof liveTargetSchema>;

/**
 * call:offer / call:answer / call:ice-candidate — one relay handler covers
 * both a 1:1 call and a live mesh leg, discriminated by `context`.
 */
export const rtcSignalSchema = z.discriminatedUnion('context', [
  z.object({
    context: z.literal('call'),
    callId: z.string().uuid(),
    payload: z.unknown(),
  }),
  z.object({
    context: z.literal('live'),
    broadcasterUserId: z.string().uuid(),
    viewerUserId: z.string().uuid(),
    payload: z.unknown(),
  }),
]);
export type RtcSignalPayload = z.infer<typeof rtcSignalSchema>;

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface IceServerDto {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceServersDto {
  iceServers: IceServerDto[];
}

// ── Server → client event payloads ───────────────────────────────────────────

export interface CallIncomingPayload {
  callId: string;
  from: UserSummaryDto;
  kind: 'audio' | 'video';
}

export interface CallLifecyclePayload {
  callId: string;
}

export interface LiveStartedPayload {
  user: UserSummaryDto;
  live: LiveSessionDto;
}

export interface LiveEndedPayload {
  userId: string;
}

export interface LiveViewerJoinedPayload {
  broadcasterUserId: string;
  viewer: UserSummaryDto;
}

export interface LiveViewerLeftPayload {
  broadcasterUserId: string;
  viewerId: string;
}

/** What the server actually forwards for an offer/answer/ice-candidate relay. */
export type RtcSignalRelayPayload = RtcSignalPayload & { fromUserId: string };

/** active-count:update — a refetch ping, no computed value in the payload. */
export interface ActiveCountUpdatePayload {
  scope: 'all' | 'friends';
}
