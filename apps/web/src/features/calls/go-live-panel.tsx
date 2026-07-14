import { useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type LiveCommentPayload,
  type LiveViewerJoinedPayload,
  type LiveViewerLeftPayload,
  type RtcSignalRelayPayload,
  type StatusVisibility,
  type UserSummaryDto,
} from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
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
  const [viewers, setViewers] = useState<Map<string, UserSummaryDto>>(new Map());
  const [comments, setComments] = useState<LiveCommentPayload['comment'][]>([]);
  const [commentText, setCommentText] = useState('');
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
        setViewers((prev) => new Map(prev).set(payload.viewer.id, payload.viewer));

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
      setViewers((prev) => {
        const next = new Map(prev);
        next.delete(payload.viewerId);
        return next;
      });
    };

    const onComment = (payload: LiveCommentPayload) => {
      if (payload.broadcasterUserId !== user.id) return;
      setComments((prev) => [...prev.slice(-29), payload.comment]);
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
    socket.on(SERVER_EVENTS.LIVE_COMMENT, onComment);
    socket.on(CLIENT_EVENTS.CALL_ANSWER, onAnswer);
    socket.on(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
    // §24.15 — join our own live room so we receive comments broadcast to it.
    socket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: user.id });
    return () => {
      socket.off(SERVER_EVENTS.LIVE_VIEWER_JOINED, onViewerJoined);
      socket.off(SERVER_EVENTS.LIVE_VIEWER_LEFT, onViewerLeft);
      socket.off(SERVER_EVENTS.LIVE_COMMENT, onComment);
      socket.off(CLIENT_EVENTS.CALL_ANSWER, onAnswer);
      socket.off(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
      socket.emit(CLIENT_EVENTS.LIVE_LEAVE, { broadcasterUserId: user.id });
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
              <option value="close_friends">Close friends</option>
            </select>
          </label>
        )}

        {live && (
          <>
            <div className="flex items-center gap-2">
              <p className="text-sm text-fg-muted">👀 {viewers.size} watching</p>
              <div className="flex -space-x-2">
                {[...viewers.values()].slice(0, 6).map((viewer) => (
                  <span key={viewer.id} className="rounded-full ring-2 ring-surface-raised">
                    <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="sm" />
                  </span>
                ))}
              </div>
            </div>

            <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-lg bg-surface-sunken p-2">
              {comments.length === 0 ? (
                <p className="text-xs text-fg-muted">No comments yet.</p>
              ) : (
                comments.map((comment) => (
                  <p key={comment.id} className="text-xs text-fg">
                    <span className="font-semibold">{comment.user.displayName}: </span>
                    {comment.text}
                  </p>
                ))
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = commentText.trim();
                if (!text || !user) return;
                getSocket()?.emit(CLIENT_EVENTS.LIVE_COMMENT, {
                  broadcasterUserId: user.id,
                  text,
                });
                setCommentText('');
              }}
              className="flex gap-2"
            >
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Say something…"
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-fg"
              />
              <Button type="submit" size="sm" disabled={!commentText.trim()}>
                Send
              </Button>
            </form>
          </>
        )}

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
