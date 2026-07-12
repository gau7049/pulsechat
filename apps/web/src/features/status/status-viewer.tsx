import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_MUSIC_TRACKS, type StatusFeedEntryDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { useAuth } from '../auth/auth-context';
import { useDeleteStatus } from './use-status';

const AUTO_ADVANCE_MS = 6000;

/**
 * Full-screen status viewer (Requirement Scope §11): tap-through between a
 * user's active statuses, auto-advancing like a story. `entries` is the
 * whole rail so ◀/▶ at the ends can move to the neighbouring person.
 */
export function StatusViewer({
  entries,
  startIndex,
  onClose,
}: {
  entries: StatusFeedEntryDto[];
  startIndex: number;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const deleteStatus = useDeleteStatus();
  const [personIndex, setPersonIndex] = useState(startIndex);
  const [statusIndex, setStatusIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const person = entries[personIndex];
  const statuses = person?.statuses ?? [];
  const status = statuses[statusIndex];
  const track = useMemo(
    () => STATUS_MUSIC_TRACKS.find((t) => t.id === status?.musicTrackId) ?? null,
    [status],
  );

  useEffect(() => {
    setStatusIndex(0);
  }, [personIndex]);

  const advance = useCallback((): void => {
    if (statusIndex < statuses.length - 1) {
      setStatusIndex((i) => i + 1);
    } else if (personIndex < entries.length - 1) {
      setPersonIndex((i) => i + 1);
    } else {
      onClose();
    }
  }, [statusIndex, statuses.length, personIndex, entries.length, onClose]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(advance, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [status, advance]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (track) {
      audio.src = track.fileUrl;
      // Placeholder tracks may 404 until the real CC0 files land — that's
      // fine, the status still displays without background music.
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [track]);

  function goBack(): void {
    if (statusIndex > 0) setStatusIndex((i) => i - 1);
    else if (personIndex > 0) {
      setPersonIndex((i) => i - 1);
      setStatusIndex(0);
    }
  }

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') goBack();
      else if (event.key === 'ArrowRight') advance();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // No deps array: goBack/advance close over current index state each
    // render, so re-binding on every render is intentional.
  });

  if (!person || !status || !user) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${person.user.displayName}'s status`}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <audio ref={audioRef} hidden />
      <div className="flex gap-1 px-3 pt-3">
        {statuses.map((s, i) => (
          <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className={`h-full bg-white ${i < statusIndex ? 'w-full' : i === statusIndex ? 'w-full transition-all duration-[6000ms] ease-linear' : 'w-0'}`}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={person.user.displayName} src={person.user.avatarUrl} size="sm" />
        <span className="text-sm font-semibold">{person.user.displayName}</span>
        {track && <span className="text-xs text-white/60">🎵 {track.title}</span>}
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="ml-auto text-xl"
        >
          ✕
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        <button
          type="button"
          aria-label="Previous"
          onClick={goBack}
          className="absolute inset-y-0 left-0 w-1/3"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={advance}
          className="absolute inset-y-0 right-0 w-1/3"
        />
        {status.mediaUrl ? (
          <img src={status.mediaUrl} alt="" className="max-h-full max-w-full object-contain" />
        ) : (
          <p className="max-w-md px-8 text-center text-2xl font-semibold">{status.caption}</p>
        )}
      </div>

      {status.mediaUrl && status.caption && (
        <p className="px-4 pb-3 text-center text-sm">{status.caption}</p>
      )}

      {status.userId === user.id && (
        <button
          type="button"
          onClick={() => void deleteStatus.mutateAsync(status.id).then(onClose)}
          className="mx-auto mb-4 rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white/80 hover:bg-white/20"
        >
          Delete this status
        </button>
      )}
    </div>
  );
}
