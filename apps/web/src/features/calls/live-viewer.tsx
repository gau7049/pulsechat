import { useEffect, useRef, useState } from 'react';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type LiveCommentPayload,
  type LiveEndedPayload,
  type LiveViewerJoinedPayload,
  type LiveViewerLeftPayload,
  type LiveViewersSnapshotPayload,
  type RtcSignalRelayPayload,
  type UserSummaryDto,
} from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
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
  const [viewers, setViewers] = useState<Map<string, UserSummaryDto>>(new Map());
  const [comments, setComments] = useState<LiveCommentPayload['comment'][]>([]);
  const [commentText, setCommentText] = useState('');
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

    // §24.15 — the snapshot on join, then live join/leave/comment updates.
    const onSnapshot = (payload: LiveViewersSnapshotPayload) => {
      if (payload.broadcasterUserId !== broadcasterUserId) return;
      setViewers(new Map(payload.viewers.map((v) => [v.id, v])));
    };
    const onViewerJoined = (payload: LiveViewerJoinedPayload) => {
      if (payload.broadcasterUserId !== broadcasterUserId) return;
      setViewers((prev) => new Map(prev).set(payload.viewer.id, payload.viewer));
    };
    const onViewerLeft = (payload: LiveViewerLeftPayload) => {
      if (payload.broadcasterUserId !== broadcasterUserId) return;
      setViewers((prev) => {
        const next = new Map(prev);
        next.delete(payload.viewerId);
        return next;
      });
    };
    const onComment = (payload: LiveCommentPayload) => {
      if (payload.broadcasterUserId !== broadcasterUserId) return;
      setComments((prev) => [...prev.slice(-29), payload.comment]);
    };

    socket.on(CLIENT_EVENTS.CALL_OFFER, onOffer);
    socket.on(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
    socket.on(SERVER_EVENTS.LIVE_ENDED, onLiveEnded);
    socket.on(SERVER_EVENTS.LIVE_VIEWERS_SNAPSHOT, onSnapshot);
    socket.on(SERVER_EVENTS.LIVE_VIEWER_JOINED, onViewerJoined);
    socket.on(SERVER_EVENTS.LIVE_VIEWER_LEFT, onViewerLeft);
    socket.on(SERVER_EVENTS.LIVE_COMMENT, onComment);
    socket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId });

    return () => {
      cancelled = true;
      socket.off(CLIENT_EVENTS.CALL_OFFER, onOffer);
      socket.off(CLIENT_EVENTS.CALL_ICE_CANDIDATE, onIceCandidate);
      socket.off(SERVER_EVENTS.LIVE_ENDED, onLiveEnded);
      socket.off(SERVER_EVENTS.LIVE_VIEWERS_SNAPSHOT, onSnapshot);
      socket.off(SERVER_EVENTS.LIVE_VIEWER_JOINED, onViewerJoined);
      socket.off(SERVER_EVENTS.LIVE_VIEWER_LEFT, onViewerLeft);
      socket.off(SERVER_EVENTS.LIVE_COMMENT, onComment);
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

      <div className="flex w-full max-w-md items-center gap-2 text-sm text-white/80">
        <span>👀 {viewers.size} watching</span>
        <div className="flex -space-x-2">
          {[...viewers.values()].slice(0, 6).map((viewer) => (
            <span key={viewer.id} className="rounded-full ring-2 ring-black">
              <Avatar name={viewer.displayName} src={viewer.avatarUrl} size="sm" />
            </span>
          ))}
        </div>
      </div>

      <div className="flex max-h-32 w-full max-w-md flex-col gap-1 overflow-y-auto rounded-lg bg-white/10 p-2">
        {comments.length === 0 ? (
          <p className="text-xs text-white/60">No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <p key={comment.id} className="text-xs">
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
          if (!text) return;
          getSocket()?.emit(CLIENT_EVENTS.LIVE_COMMENT, { broadcasterUserId, text });
          setCommentText('');
        }}
        className="flex w-full max-w-md gap-2"
      >
        <input
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Say something…"
          className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-white/50"
        />
        <Button type="submit" size="sm" disabled={!commentText.trim()}>
          Send
        </Button>
      </form>

      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
