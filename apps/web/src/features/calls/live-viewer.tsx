import { useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type LiveEndedPayload,
  type RtcSignalRelayPayload,
} from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../auth/auth-context';
import { VideoTag } from './call-overlay';
import { createPeerConnection, makeCandidateQueue } from './webrtc';

/** Viewer side of the live mesh (Requirement Scope §12) — receive-only. */
export function LiveViewer({
  broadcasterUserId,
  onClose,
}: {
  broadcasterUserId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<ReturnType<typeof makeCandidateQueue> | null>(null);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    let cancelled = false;

    const onOffer = (payload: RtcSignalRelayPayload) => {
      void (async () => {
        if (
          payload.context !== 'live' ||
          payload.broadcasterUserId !== broadcasterUserId ||
          payload.viewerUserId !== user.id ||
          cancelled
        ) {
          return;
        }
        const pc = await createPeerConnection({
          onIceCandidate: (candidate) => {
            socket.emit(CLIENT_EVENTS.CALL_ICE_CANDIDATE, {
              context: 'live',
              broadcasterUserId,
              viewerUserId: user.id,
              payload: candidate,
            });
          },
          onTrack: (stream) => setRemoteStream(stream),
        });
        pcRef.current = pc;
        candidateQueueRef.current = makeCandidateQueue(pc);
        await pc.setRemoteDescription(
          new RTCSessionDescription(payload.payload as RTCSessionDescriptionInit),
        );
        candidateQueueRef.current.flush();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit(CLIENT_EVENTS.CALL_ANSWER, {
          context: 'live',
          broadcasterUserId,
          viewerUserId: user.id,
          payload: answer,
        });
      })();
    };

    const onIceCandidate = (payload: RtcSignalRelayPayload) => {
      if (payload.context !== 'live' || payload.broadcasterUserId !== broadcasterUserId) return;
      candidateQueueRef.current?.add(payload.payload as RTCIceCandidateInit);
    };

    const onLiveEnded = (payload: LiveEndedPayload) => {
      if (payload.userId !== broadcasterUserId) return;
      toast('This live broadcast has ended', { kind: 'info' });
      onClose();
    };

    socket.on(CLIENT_EVENTS.CALL_OFFER, onOffer);
    socket.on(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
    socket.on(SERVER_EVENTS.LIVE_ENDED, onLiveEnded);
    socket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId });

    return () => {
      cancelled = true;
      socket.off(CLIENT_EVENTS.CALL_OFFER, onOffer);
      socket.off(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
      socket.off(SERVER_EVENTS.LIVE_ENDED, onLiveEnded);
      socket.emit(CLIENT_EVENTS.LIVE_LEAVE, { broadcasterUserId });
      pcRef.current?.close();
      pcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join once per broadcaster
  }, [broadcasterUserId, user?.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black p-6 text-white">
      <div className="w-full max-w-md">
        {remoteStream ? (
          <VideoTag stream={remoteStream} muted={false} />
        ) : (
          <p className="py-16 text-center text-sm text-white/70">Connecting…</p>
        )}
      </div>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
