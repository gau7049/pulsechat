import { useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type LiveViewerJoinedPayload,
  type LiveViewerLeftPayload,
  type RtcSignalRelayPayload,
  type StatusVisibility,
} from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { getSocket } from '../../lib/socket';
import { useAuth } from '../auth/auth-context';
import { useEndLive, useStartLive } from '../status/use-status';
import { VideoTag } from './call-overlay';
import {
  attachLocalTracks,
  createPeerConnection,
  getLocalStream,
  makeCandidateQueue,
  stopStream,
} from './webrtc';

interface ViewerConnection {
  pc: RTCPeerConnection;
  candidateQueue: ReturnType<typeof makeCandidateQueue>;
}

/**
 * Broadcaster side of the live mesh (Requirement Scope §12): one outbound
 * `RTCPeerConnection` per viewer, offered as each `live:viewer-joined`
 * arrives — the documented scaling ceiling of a single-VM free-tier setup
 * (Technical Spec §11).
 */
export function GoLivePanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const startLive = useStartLive();
  const endLive = useEndLive();
  const [visibility, setVisibility] = useState<StatusVisibility>('everyone');
  const [live, setLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const localStreamRef = useRef<MediaStream | null>(null);
  const viewersRef = useRef<Map<string, ViewerConnection>>(new Map());
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    void getLocalStream('video')
      .then(setLocalStream)
      .catch(() => {
        toast('Camera/microphone access is needed to go live', { kind: 'error' });
      });
    const viewers = viewersRef.current;
    return () => {
      stopStream(localStreamRef.current);
      for (const viewer of viewers.values()) viewer.pc.close();
      viewers.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- acquire media once on mount
  }, []);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!user || !live) return;
    const socket = getSocket();
    if (!socket) return;

    const onViewerJoined = (payload: LiveViewerJoinedPayload) => {
      void (async () => {
        if (payload.broadcasterUserId !== user.id || !localStreamRef.current) return;
        const pc = await createPeerConnection({
          onIceCandidate: (candidate) => {
            socket.emit(CLIENT_EVENTS.CALL_ICE_CANDIDATE, {
              context: 'live',
              broadcasterUserId: user.id,
              viewerUserId: payload.viewer.id,
              payload: candidate,
            });
          },
          onTrack: () => undefined,
        });
        attachLocalTracks(pc, localStreamRef.current);
        viewersRef.current.set(payload.viewer.id, { pc, candidateQueue: makeCandidateQueue(pc) });
        setViewerCount(viewersRef.current.size);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit(CLIENT_EVENTS.CALL_OFFER, {
          context: 'live',
          broadcasterUserId: user.id,
          viewerUserId: payload.viewer.id,
          payload: offer,
        });
      })();
    };

    const onViewerLeft = (payload: LiveViewerLeftPayload) => {
      if (payload.broadcasterUserId !== user.id) return;
      viewersRef.current.get(payload.viewerId)?.pc.close();
      viewersRef.current.delete(payload.viewerId);
      setViewerCount(viewersRef.current.size);
    };

    const onAnswer = (payload: RtcSignalRelayPayload) => {
      void (async () => {
        if (payload.context !== 'live' || payload.broadcasterUserId !== user.id) return;
        const viewer = viewersRef.current.get(payload.viewerUserId);
        if (!viewer) return;
        await viewer.pc.setRemoteDescription(
          new RTCSessionDescription(payload.payload as RTCSessionDescriptionInit),
        );
        viewer.candidateQueue.flush();
      })();
    };

    const onIceCandidate = (payload: RtcSignalRelayPayload) => {
      if (payload.context !== 'live' || payload.broadcasterUserId !== user.id) return;
      viewersRef.current
        .get(payload.viewerUserId)
        ?.candidateQueue.add(payload.payload as RTCIceCandidateInit);
    };

    socket.on(SERVER_EVENTS.LIVE_VIEWER_JOINED, onViewerJoined);
    socket.on(SERVER_EVENTS.LIVE_VIEWER_LEFT, onViewerLeft);
    socket.on(CLIENT_EVENTS.CALL_ANSWER, onAnswer);
    socket.on(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
    return () => {
      socket.off(SERVER_EVENTS.LIVE_VIEWER_JOINED, onViewerJoined);
      socket.off(SERVER_EVENTS.LIVE_VIEWER_LEFT, onViewerLeft);
      socket.off(CLIENT_EVENTS.CALL_ANSWER, onAnswer);
      socket.off(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
    };
  }, [user, live]);

  async function handleStart(): Promise<void> {
    try {
      await startLive.mutateAsync({ visibility });
      setLive(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not go live', { kind: 'error' });
    }
  }

  async function handleEnd(): Promise<void> {
    for (const viewer of viewersRef.current.values()) viewer.pc.close();
    viewersRef.current.clear();
    if (live) await endLive.mutateAsync().catch(() => undefined);
    onClose();
  }

  return (
    <Modal open onClose={() => void handleEnd()} title={live ? 'You are live' : 'Go live'}>
      <div className="flex flex-col gap-3">
        <VideoTag stream={localStream} muted />

        {!live && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Who can watch</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as StatusVisibility)}
              className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-fg"
            >
              <option value="everyone">Everyone</option>
              <option value="friends">Friends only</option>
            </select>
          </label>
        )}

        {live && <p className="text-sm text-fg-muted">👀 {viewerCount} watching</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void handleEnd()}>
            {live ? 'End live' : 'Cancel'}
          </Button>
          {!live && (
            <Button type="button" loading={startLive.isPending} onClick={() => void handleStart()}>
              Start
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
