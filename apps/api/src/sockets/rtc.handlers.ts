import type { Socket } from 'socket.io';
import type { ZodTypeAny, z } from 'zod';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  callActionSchema,
  callInviteSchema,
  liveTargetSchema,
  rtcSignalSchema,
  type CallIncomingPayload,
  type CallLifecyclePayload,
  type LiveViewerJoinedPayload,
  type LiveViewerLeftPayload,
  type RtcSignalRelayPayload,
} from '@pulsechat/shared';
import { getIo } from '../lib/io.js';
import { logger } from '../lib/logger.js';
import * as liveRepo from '../repositories/live.repository.js';
import * as social from '../repositories/social.repository.js';
import * as users from '../repositories/user.repository.js';
import { isOnline } from '../services/presence.service.js';
import { toUserSummaryDto } from '../services/user-summary.serializer.js';

/**
 * WebRTC signaling (Technical Spec §9, §11): 1:1 calls and the live-mesh
 * broadcast share one offer/answer/ice-candidate relay, discriminated by
 * `context`. The server authorizes and forwards; it never inspects SDP.
 */

interface CallPairing {
  callerUserId: string;
  calleeUserId: string;
}

/** callId -> the two parties. Module-level, same style as presence.service's socket map. */
const activeCalls = new Map<string, CallPairing>();

function parse<TSchema extends ZodTypeAny>(
  schema: TSchema,
  payload: unknown,
): z.infer<TSchema> | null {
  const result = schema.safeParse(payload);
  return result.success ? (result.data as z.infer<TSchema>) : null;
}

function otherPartyOf(callId: string, userId: string): string | null {
  const pairing = activeCalls.get(callId);
  if (!pairing) return null;
  if (pairing.callerUserId === userId) return pairing.calleeUserId;
  if (pairing.calleeUserId === userId) return pairing.callerUserId;
  return null;
}

function endCall(callId: string, byUserId: string): void {
  const pairing = activeCalls.get(callId);
  if (!pairing) return;
  activeCalls.delete(callId);
  const otherId = pairing.callerUserId === byUserId ? pairing.calleeUserId : pairing.callerUserId;
  const event: CallLifecyclePayload = { callId };
  getIo()?.to(`user:${otherId}`).emit(SERVER_EVENTS.CALL_ENDED, event);
  logger.info({ event: 'rtc.call_ended', callId, byUserId }, 'call ended');
}

/** Live viewer authorization: friend-gated, same scope as the status/live rail. */
async function canViewLive(viewerId: string, broadcasterId: string): Promise<boolean> {
  if (viewerId === broadcasterId) return true;
  const block = await social.findBlockBetween(viewerId, broadcasterId);
  if (block) return false;
  return Boolean(await social.findFriendship(viewerId, broadcasterId));
}

export function registerRtcHandlers(socket: Socket): void {
  const userId = socket.data.userId as string;

  // ── 1:1 calls (§14.4) ────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.CALL_INVITE, (payload: unknown) => {
    void (async () => {
      const parsed = parse(callInviteSchema, payload);
      if (!parsed || parsed.toUserId === userId) return;
      const block = await social.findBlockBetween(userId, parsed.toUserId);
      if (block) return;
      const friendship = await social.findFriendship(userId, parsed.toUserId);
      if (!friendship || !isOnline(parsed.toUserId)) return;

      activeCalls.set(parsed.callId, { callerUserId: userId, calleeUserId: parsed.toUserId });
      const caller = await users.findById(userId);
      if (!caller) return;
      const incoming: CallIncomingPayload = {
        callId: parsed.callId,
        from: toUserSummaryDto(caller),
        kind: parsed.kind,
      };
      getIo()?.to(`user:${parsed.toUserId}`).emit(SERVER_EVENTS.CALL_INCOMING, incoming);
    })();
  });

  socket.on(CLIENT_EVENTS.CALL_ACCEPT, (payload: unknown) => {
    const parsed = parse(callActionSchema, payload);
    const pairing = parsed ? activeCalls.get(parsed.callId) : undefined;
    if (!parsed || !pairing || pairing.calleeUserId !== userId) return;
    const event: CallLifecyclePayload = { callId: parsed.callId };
    getIo()?.to(`user:${pairing.callerUserId}`).emit(SERVER_EVENTS.CALL_ACCEPTED, event);
  });

  socket.on(CLIENT_EVENTS.CALL_REJECT, (payload: unknown) => {
    const parsed = parse(callActionSchema, payload);
    if (parsed) endCall(parsed.callId, userId);
  });

  socket.on(CLIENT_EVENTS.CALL_END, (payload: unknown) => {
    const parsed = parse(callActionSchema, payload);
    if (parsed) endCall(parsed.callId, userId);
  });

  // ── Live mesh (§12) ──────────────────────────────────────────────────────

  socket.on(CLIENT_EVENTS.LIVE_JOIN, (payload: unknown) => {
    void (async () => {
      const parsed = parse(liveTargetSchema, payload);
      if (!parsed) return;
      const allowed = await canViewLive(userId, parsed.broadcasterUserId);
      const active = allowed ? await liveRepo.findActiveForUser(parsed.broadcasterUserId) : null;
      if (!active) return;
      await socket.join(`live:${parsed.broadcasterUserId}`);
      const viewer = await users.findById(userId);
      if (!viewer) return;
      const event: LiveViewerJoinedPayload = {
        broadcasterUserId: parsed.broadcasterUserId,
        viewer: toUserSummaryDto(viewer),
      };
      getIo()?.to(`user:${parsed.broadcasterUserId}`).emit(SERVER_EVENTS.LIVE_VIEWER_JOINED, event);
    })();
  });

  socket.on(CLIENT_EVENTS.LIVE_LEAVE, (payload: unknown) => {
    void (async () => {
      const parsed = parse(liveTargetSchema, payload);
      if (!parsed) return;
      await socket.leave(`live:${parsed.broadcasterUserId}`);
      const event: LiveViewerLeftPayload = {
        broadcasterUserId: parsed.broadcasterUserId,
        viewerId: userId,
      };
      getIo()?.to(`user:${parsed.broadcasterUserId}`).emit(SERVER_EVENTS.LIVE_VIEWER_LEFT, event);
    })();
  });

  // ── Shared offer/answer/ice-candidate relay ─────────────────────────────

  for (const event of [
    CLIENT_EVENTS.CALL_OFFER,
    CLIENT_EVENTS.CALL_ANSWER,
    CLIENT_EVENTS.CALL_ICE_CANDIDATE,
  ] as const) {
    socket.on(event, (payload: unknown) => {
      const parsed = parse(rtcSignalSchema, payload);
      if (!parsed) return;
      const toUserId =
        parsed.context === 'call'
          ? otherPartyOf(parsed.callId, userId)
          : parsed.broadcasterUserId === userId
            ? parsed.viewerUserId
            : parsed.broadcasterUserId;
      if (!toUserId) return;
      const relay: RtcSignalRelayPayload = { ...parsed, fromUserId: userId };
      getIo()?.to(`user:${toUserId}`).emit(event, relay);
    });
  }

  // A call is bound to this one socket's peer connection — end it regardless
  // of whether the user has other devices still connected.
  socket.on('disconnect', () => {
    for (const [callId, pairing] of activeCalls) {
      if (pairing.callerUserId === userId || pairing.calleeUserId === userId) {
        endCall(callId, userId);
      }
    }
  });
}
