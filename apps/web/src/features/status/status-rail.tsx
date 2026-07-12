import { useState } from 'react';
import { Avatar } from '../../components/ui/avatar';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { GoLivePanel } from '../calls/go-live-panel';
import { LiveViewer } from '../calls/live-viewer';
import { StatusComposer } from './status-composer';
import { StatusViewer } from './status-viewer';
import { useStatusFeed } from './use-status';

/**
 * Status/live rail (Requirement Scope §12.1): self + friends with an active
 * status or live broadcast. A distinct ring style marks live vs. plain
 * status, and live-having friends are already sorted first by the API.
 */
export function StatusRail() {
  const { user } = useAuth();
  const feed = useStatusFeed();
  const [composing, setComposing] = useState(false);
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [goingLive, setGoingLive] = useState(false);
  const [watchingUserId, setWatchingUserId] = useState<string | null>(null);

  if (!user) return null;
  const entries = feed.data?.items ?? [];
  const mineIndex = entries.findIndex((e) => e.user.id === user.id);
  const mine = mineIndex >= 0 ? entries[mineIndex] : undefined;

  return (
    <div className="flex items-start gap-3">
      <div className="flex flex-1 gap-3 overflow-x-auto pb-1">
        <RailTile
          name={user.displayName}
          avatarUrl={user.avatarUrl}
          ring={mine?.live ? 'live' : mine ? 'status' : 'none'}
          plusBadge
          onClick={() => (mine ? setViewingIndex(mineIndex) : setComposing(true))}
          onPlusClick={() => setComposing(true)}
        />

        {feed.isLoading && (
          <div aria-hidden className="flex gap-3">
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <Skeleton className="size-14 shrink-0 rounded-full" />
          </div>
        )}
        {entries
          .filter((entry) => entry.user.id !== user.id)
          .map((entry) => {
            const index = entries.indexOf(entry);
            return (
              <RailTile
                key={entry.user.id}
                name={entry.user.displayName}
                avatarUrl={entry.user.avatarUrl}
                ring={entry.live ? 'live' : 'status'}
                onClick={() =>
                  entry.live ? setWatchingUserId(entry.user.id) : setViewingIndex(index)
                }
              />
            );
          })}
      </div>

      <button
        type="button"
        onClick={() => setGoingLive(true)}
        className="mt-1 shrink-0 rounded-lg border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-sunken"
      >
        🔴 Go live
      </button>

      {composing && <StatusComposer onClose={() => setComposing(false)} />}
      {viewingIndex !== null && (
        <StatusViewer
          entries={entries}
          startIndex={viewingIndex}
          onClose={() => setViewingIndex(null)}
        />
      )}
      {goingLive && <GoLivePanel onClose={() => setGoingLive(false)} />}
      {watchingUserId && (
        <LiveViewer broadcasterUserId={watchingUserId} onClose={() => setWatchingUserId(null)} />
      )}
    </div>
  );
}

function RailTile({
  name,
  avatarUrl,
  ring,
  plusBadge,
  onClick,
  onPlusClick,
}: {
  name: string;
  avatarUrl: string | null;
  ring: 'live' | 'status' | 'none';
  plusBadge?: boolean;
  onClick: () => void;
  onPlusClick?: () => void;
}) {
  const ringClass =
    ring === 'live'
      ? 'ring-2 ring-danger ring-offset-2 ring-offset-surface'
      : ring === 'status'
        ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
        : '';

  return (
    <div className="relative flex w-16 shrink-0 flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={ring === 'live' ? `${name} is live` : name}
        title={
          ring === 'live'
            ? `${name} is live — tap to watch`
            : ring === 'status'
              ? `View ${name}'s status`
              : name
        }
        className={`rounded-full ${ringClass}`}
      >
        <Avatar name={name} src={avatarUrl} size="md" />
      </button>
      {plusBadge && onPlusClick && (
        <button
          type="button"
          aria-label="Add a status"
          title="Add a status"
          onClick={onPlusClick}
          className="absolute top-6 right-0 flex size-5 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent"
        >
          +
        </button>
      )}
      <span className="w-full truncate text-center text-[11px] text-fg-muted">{name}</span>
    </div>
  );
}
