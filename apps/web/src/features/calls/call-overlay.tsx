import { useEffect, useRef } from 'react';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { useAcceptCall, useCallState, useEndCall, useRejectCall } from './use-calls';

export function VideoTag({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className="aspect-video w-full rounded-xl bg-black object-cover"
    />
  );
}

function AudioTag({ stream, muted }: { stream: MediaStream | null; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay muted={muted} />;
}

function MediaTag({
  stream,
  kind,
  muted,
}: {
  stream: MediaStream | null;
  kind: 'audio' | 'video';
  muted: boolean;
}) {
  return kind === 'video' ? (
    <VideoTag stream={stream} muted={muted} />
  ) : (
    <AudioTag stream={stream} muted={muted} />
  );
}

/**
 * 1:1 call UI (Requirement Scope §14.4): mounted once in the app shell so an
 * incoming call rings regardless of the current route.
 */
export function CallOverlay() {
  const state = useCallState();
  const accept = useAcceptCall();
  const reject = useRejectCall();
  const end = useEndCall();

  if (state.status === 'idle') return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black/80 p-6 text-center text-white">
      {state.status === 'ringing-incoming' && (
        <>
          <Avatar name={state.otherUser.displayName} src={state.otherUser.avatarUrl} size="lg" />
          <div>
            <p className="text-lg font-semibold">{state.otherUser.displayName}</p>
            <p className="text-sm text-white/70">
              Incoming {state.kind === 'video' ? 'video' : 'voice'} call…
            </p>
          </div>
          <div className="flex gap-4">
            <Button variant="danger" onClick={() => reject()}>
              Decline
            </Button>
            <Button onClick={() => void accept()}>Accept</Button>
          </div>
        </>
      )}

      {state.status === 'ringing-outgoing' && (
        <>
          <Avatar name={state.otherUser.displayName} src={state.otherUser.avatarUrl} size="lg" />
          <div>
            <p className="text-lg font-semibold">{state.otherUser.displayName}</p>
            <p className="text-sm text-white/70">Ringing…</p>
          </div>
          <Button variant="danger" onClick={() => end()}>
            Cancel
          </Button>
        </>
      )}

      {state.status === 'in-call' && (
        <>
          <div className="w-full max-w-md">
            {state.remoteStream ? (
              <MediaTag stream={state.remoteStream} kind={state.kind} muted={false} />
            ) : (
              <div className="flex flex-col items-center gap-3 py-10">
                <Avatar
                  name={state.otherUser.displayName}
                  src={state.otherUser.avatarUrl}
                  size="lg"
                />
                <p className="text-sm text-white/70">Connecting…</p>
              </div>
            )}
          </div>
          {state.kind === 'video' && state.localStream && (
            <div className="absolute right-4 bottom-24 w-28">
              <MediaTag stream={state.localStream} kind="video" muted />
            </div>
          )}
          <p className="text-sm font-medium">{state.otherUser.displayName}</p>
          <Button variant="danger" onClick={() => end()}>
            Hang up
          </Button>
        </>
      )}
    </div>
  );
}
