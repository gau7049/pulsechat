import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type CallIncomingPayload,
  type CallLifecyclePayload,
  type RtcSignalRelayPayload,
  type UserSummaryDto,
} from '@pulsechat/shared';
import { getSocket } from '../../lib/socket';
import { getCallState, setCallState, subscribeCallState, type CallState } from './call-live-store';
import {
  attachLocalTracks,
  createPeerConnection,
  getLocalStream,
  makeCandidateQueue,
  stopStream,
} from './webrtc';

/**
 * 1:1 call signaling (Requirement Scope §14.4, Technical Spec §9, §11): the
 * caller offers once `call:accepted` arrives, both sides queue ICE
 * candidates until their remote description lands. One call at a time —
 * a second invite while a session is active is treated as "busy".
 */

interface CallSession {
  callId: string;
  pc: RTCPeerConnection;
  localStream: MediaStream;
  candidateQueue: ReturnType<typeof makeCandidateQueue>;
  role: 'caller' | 'callee';
}

let session: CallSession | null = null;

function cleanupSession(): void {
  if (!session) return;
  stopStream(session.localStream);
  session.pc.close();
  session = null;
}

export function useCallState(): CallState {
  return useSyncExternalStore(subscribeCallState, getCallState);
}

export function useStartCall() {
  return useCallback(async (otherUser: UserSummaryDto, kind: 'audio' | 'video') => {
    if (session || getCallState().status !== 'idle') return;
    const callId = crypto.randomUUID();
    const localStream = await getLocalStream(kind);
    const pc = await createPeerConnection({
      onIceCandidate: (candidate) => {
        getSocket()?.emit(CLIENT_EVENTS.CALL_ICE_CANDIDATE, {
          context: 'call',
          callId,
          payload: candidate,
        });
      },
      onTrack: (stream) => {
        const current = getCallState();
        if (current.status === 'in-call' && current.callId === callId) {
          setCallState({ ...current, remoteStream: stream });
        }
      },
    });
    attachLocalTracks(pc, localStream);
    session = { callId, pc, localStream, candidateQueue: makeCandidateQueue(pc), role: 'caller' };
    setCallState({ status: 'ringing-outgoing', callId, otherUser, kind });
    getSocket()?.emit(CLIENT_EVENTS.CALL_INVITE, { callId, toUserId: otherUser.id, kind });
  }, []);
}

export function useAcceptCall() {
  return useCallback(async () => {
    const current = getCallState();
    if (current.status !== 'ringing-incoming') return;
    const localStream = await getLocalStream(current.kind);
    const { callId } = current;
    const pc = await createPeerConnection({
      onIceCandidate: (candidate) => {
        getSocket()?.emit(CLIENT_EVENTS.CALL_ICE_CANDIDATE, {
          context: 'call',
          callId,
          payload: candidate,
        });
      },
      onTrack: (stream) => {
        const now = getCallState();
        if (now.status === 'in-call' && now.callId === callId) {
          setCallState({ ...now, remoteStream: stream });
        }
      },
    });
    attachLocalTracks(pc, localStream);
    session = { callId, pc, localStream, candidateQueue: makeCandidateQueue(pc), role: 'callee' };
    setCallState({
      status: 'in-call',
      callId,
      otherUser: current.otherUser,
      kind: current.kind,
      localStream,
      remoteStream: null,
    });
    getSocket()?.emit(CLIENT_EVENTS.CALL_ACCEPT, { callId });
  }, []);
}

export function useRejectCall() {
  return useCallback(() => {
    const current = getCallState();
    if (current.status === 'idle') return;
    if (current.status === 'ringing-incoming') {
      getSocket()?.emit(CLIENT_EVENTS.CALL_REJECT, { callId: current.callId });
    }
    cleanupSession();
    setCallState({ status: 'idle' });
  }, []);
}

export function useEndCall() {
  return useCallback(() => {
    const current = getCallState();
    if (current.status === 'idle') return;
    getSocket()?.emit(CLIENT_EVENTS.CALL_END, { callId: current.callId });
    cleanupSession();
    setCallState({ status: 'idle' });
  }, []);
}

/** Mounted once, alongside `useChatSocketBridge`, in the signed-in app shell. */
export function useCallSocketBridge(userId: string | undefined): void {
  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    if (!socket) return;

    const onIncoming = (payload: CallIncomingPayload) => {
      // Already on a call — silently decline instead of double-ringing.
      if (session || getCallState().status !== 'idle') {
        socket.emit(CLIENT_EVENTS.CALL_REJECT, { callId: payload.callId });
        return;
      }
      setCallState({
        status: 'ringing-incoming',
        callId: payload.callId,
        otherUser: payload.from,
        kind: payload.kind,
      });
    };

    const onAccepted = (payload: CallLifecyclePayload) => {
      void (async () => {
        if (!session || session.callId !== payload.callId || session.role !== 'caller') return;
        const offer = await session.pc.createOffer();
        await session.pc.setLocalDescription(offer);
        socket.emit(CLIENT_EVENTS.CALL_OFFER, {
          context: 'call',
          callId: payload.callId,
          payload: offer,
        });
        const current = getCallState();
        if (current.status === 'ringing-outgoing' && current.callId === payload.callId) {
          setCallState({
            status: 'in-call',
            callId: payload.callId,
            otherUser: current.otherUser,
            kind: current.kind,
            localStream: session.localStream,
            remoteStream: null,
          });
        }
      })();
    };

    const onRejectedOrEnded = (payload: CallLifecyclePayload) => {
      const current = getCallState();
      if (current.status !== 'idle' && current.callId === payload.callId) {
        cleanupSession();
        setCallState({ status: 'idle' });
      }
    };

    const onOffer = (payload: RtcSignalRelayPayload) => {
      void (async () => {
        if (payload.context !== 'call' || !session || session.callId !== payload.callId) return;
        if (session.role !== 'callee') return;
        await session.pc.setRemoteDescription(
          new RTCSessionDescription(payload.payload as RTCSessionDescriptionInit),
        );
        session.candidateQueue.flush();
        const answer = await session.pc.createAnswer();
        await session.pc.setLocalDescription(answer);
        socket.emit(CLIENT_EVENTS.CALL_ANSWER, {
          context: 'call',
          callId: payload.callId,
          payload: answer,
        });
      })();
    };

    const onAnswer = (payload: RtcSignalRelayPayload) => {
      void (async () => {
        if (payload.context !== 'call' || !session || session.callId !== payload.callId) return;
        if (session.role !== 'caller') return;
        await session.pc.setRemoteDescription(
          new RTCSessionDescription(payload.payload as RTCSessionDescriptionInit),
        );
        session.candidateQueue.flush();
      })();
    };

    const onIceCandidate = (payload: RtcSignalRelayPayload) => {
      if (payload.context !== 'call' || !session || session.callId !== payload.callId) return;
      session.candidateQueue.add(payload.payload as RTCIceCandidateInit);
    };

    const onDisconnect = () => {
      if (getCallState().status === 'idle') return;
      cleanupSession();
      setCallState({ status: 'idle' });
    };

    socket.on(SERVER_EVENTS.CALL_INCOMING, onIncoming);
    socket.on(SERVER_EVENTS.CALL_ACCEPTED, onAccepted);
    socket.on(SERVER_EVENTS.CALL_REJECTED, onRejectedOrEnded);
    socket.on(SERVER_EVENTS.CALL_ENDED, onRejectedOrEnded);
    socket.on(CLIENT_EVENTS.CALL_OFFER, onOffer);
    socket.on(CLIENT_EVENTS.CALL_ANSWER, onAnswer);
    socket.on(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off(SERVER_EVENTS.CALL_INCOMING, onIncoming);
      socket.off(SERVER_EVENTS.CALL_ACCEPTED, onAccepted);
      socket.off(SERVER_EVENTS.CALL_REJECTED, onRejectedOrEnded);
      socket.off(SERVER_EVENTS.CALL_ENDED, onRejectedOrEnded);
      socket.off(CLIENT_EVENTS.CALL_OFFER, onOffer);
      socket.off(CLIENT_EVENTS.CALL_ANSWER, onAnswer);
      socket.off(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
      socket.off('disconnect', onDisconnect);
    };
  }, [userId]);
}
