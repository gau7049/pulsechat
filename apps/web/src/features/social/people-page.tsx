import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useDebouncedValue } from '../../lib/use-debounced-value';
import { InviteShareButton } from './invite-share-button';
import { RelationshipButton } from './relationship-button';
import { UserCard } from './user-card';
import {
  useAddCloseFriend,
  useCloseFriends,
  useFriendRequests,
  useFriends,
  useRemoveCloseFriend,
  useSuggestions,
  useUserSearch,
} from './use-social';

const TABS = [
  { path: 'search', label: 'Search' },
  { path: 'suggestions', label: 'Suggestions' },
  { path: 'requests', label: 'Requests' },
  { path: 'friends', label: 'Friends' },
  { path: 'close-friends', label: 'Close Friends' },
] as const;

/** Social hub (Requirement Scope §9–10): find, request, and manage friends. */
export function PeoplePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">People</h1>
        <InviteShareButton />
      </div>

      <nav
        aria-label="People sections"
        className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-sunken p-1"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/people/${tab.path}`}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
        <Routes>
          <Route index element={<Navigate to="search" replace />} />
          <Route path="search" element={<SearchTab />} />
          <Route path="suggestions" element={<SuggestionsTab />} />
          <Route path="requests" element={<RequestsTab />} />
          <Route path="friends" element={<FriendsTab />} />
          <Route path="close-friends" element={<CloseFriendsTab />} />
        </Routes>
      </div>
    </main>
  );
}

function ListSkeleton() {
  return (
    <div aria-hidden>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <EmptyState
      icon="⚠️"
      title="Could not load this list"
      description="Check your connection and try again."
      action={
        <Button variant="secondary" onClick={retry}>
          Retry
        </Button>
      }
    />
  );
}

function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  if (!hasNextPage) return null;
  return (
    <div className="flex justify-center pt-2">
      <Button variant="ghost" size="sm" loading={isFetchingNextPage} onClick={fetchNextPage}>
        Show more
      </Button>
    </div>
  );
}

function SearchTab() {
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term);
  const search = useUserSearch(debounced);
  const results = search.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Find people"
        type="search"
        placeholder="Search by username or name…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        autoFocus
      />
      {search.isLoading && debounced.trim() ? (
        <ListSkeleton />
      ) : search.isError ? (
        <LoadError retry={() => void search.refetch()} />
      ) : results.length > 0 ? (
        <div className="flex flex-col" role="list" aria-label="Search results">
          {results.map((result) => (
            <UserCard
              key={result.id}
              user={result}
              action={<RelationshipButton userId={result.id} {...result} />}
            />
          ))}
          <LoadMore
            hasNextPage={search.hasNextPage}
            isFetchingNextPage={search.isFetchingNextPage}
            fetchNextPage={() => void search.fetchNextPage()}
          />
        </div>
      ) : debounced.trim() ? (
        <EmptyState
          icon="🔍"
          title="No one found"
          description={`Nobody matches “${debounced.trim()}”. Try a different name or invite them to join.`}
        />
      ) : (
        <EmptyState
          icon="👋"
          title="Search for people you know"
          description="Look up friends by username or display name to send them a friend request."
        />
      )}
    </div>
  );
}

function SuggestionsTab() {
  const suggestions = useSuggestions();

  if (suggestions.isLoading) return <ListSkeleton />;
  if (suggestions.isError) return <LoadError retry={() => void suggestions.refetch()} />;
  const items = suggestions.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon="✨"
        title="No suggestions yet"
        description="Once you have a few friends, people you may know will show up here."
      />
    );
  }
  return (
    <div className="flex flex-col" role="list" aria-label="People you may know">
      {items.map((suggestion) => (
        <UserCard
          key={suggestion.user.id}
          user={suggestion.user}
          subtitle={`${suggestion.mutualCount} mutual friend${suggestion.mutualCount === 1 ? '' : 's'}`}
          action={
            <RelationshipButton
              userId={suggestion.user.id}
              relationship="none"
              canSendRequest
              requestId={null}
            />
          }
        />
      ))}
    </div>
  );
}

function RequestsTab() {
  const incoming = useFriendRequests('incoming');
  const outgoing = useFriendRequests('outgoing');
  const incomingItems = incoming.data?.pages.flatMap((page) => page.items) ?? [];
  const outgoingItems = outgoing.data?.pages.flatMap((page) => page.items) ?? [];

  if (incoming.isLoading || outgoing.isLoading) return <ListSkeleton />;
  if (incoming.isError || outgoing.isError) {
    return <LoadError retry={() => void Promise.all([incoming.refetch(), outgoing.refetch()])} />;
  }
  if (incomingItems.length === 0 && outgoingItems.length === 0) {
    return (
      <EmptyState
        icon="📬"
        title="No pending requests"
        description="Friend requests you send or receive will wait here."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {incomingItems.length > 0 && (
        <section aria-label="Received requests">
          <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Received
          </h2>
          {incomingItems.map((request) => (
            <UserCard
              key={request.id}
              user={request.user}
              action={
                <RelationshipButton
                  userId={request.user.id}
                  relationship="incoming_pending"
                  canSendRequest={false}
                  requestId={request.id}
                />
              }
            />
          ))}
          <LoadMore
            hasNextPage={incoming.hasNextPage}
            isFetchingNextPage={incoming.isFetchingNextPage}
            fetchNextPage={() => void incoming.fetchNextPage()}
          />
        </section>
      )}
      {outgoingItems.length > 0 && (
        <section aria-label="Sent requests">
          <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Sent
          </h2>
          {outgoingItems.map((request) => (
            <UserCard
              key={request.id}
              user={request.user}
              action={
                <RelationshipButton
                  userId={request.user.id}
                  relationship="outgoing_pending"
                  canSendRequest={false}
                  requestId={request.id}
                />
              }
            />
          ))}
          <LoadMore
            hasNextPage={outgoing.hasNextPage}
            isFetchingNextPage={outgoing.isFetchingNextPage}
            fetchNextPage={() => void outgoing.fetchNextPage()}
          />
        </section>
      )}
    </div>
  );
}

function FriendsTab() {
  const friends = useFriends();
  const items = friends.data?.pages.flatMap((page) => page.items) ?? [];

  if (friends.isLoading) return <ListSkeleton />;
  if (friends.isError) return <LoadError retry={() => void friends.refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon="🤝"
        title="No friends yet"
        description="Search for people you know or share your invite link to get started."
      />
    );
  }
  return (
    <div className="flex flex-col" role="list" aria-label="Friends">
      {items.map((friend) => (
        <UserCard
          key={friend.user.id}
          user={friend.user}
          subtitle={`Friends since ${new Date(friend.friendsSince).toLocaleDateString()}`}
        />
      ))}
      <LoadMore
        hasNextPage={friends.hasNextPage}
        isFetchingNextPage={friends.isFetchingNextPage}
        fetchNextPage={() => void friends.fetchNextPage()}
      />
    </div>
  );
}

/** §24.12 — a private, story-audience subset of your friends. */
function CloseFriendsTab() {
  const closeFriends = useCloseFriends();
  const friends = useFriends();
  const addCloseFriend = useAddCloseFriend();
  const removeCloseFriend = useRemoveCloseFriend();

  if (closeFriends.isLoading || friends.isLoading) return <ListSkeleton />;
  if (closeFriends.isError || friends.isError) {
    return (
      <LoadError retry={() => void Promise.all([closeFriends.refetch(), friends.refetch()])} />
    );
  }

  const closeIds = new Set((closeFriends.data?.items ?? []).map((i) => i.user.id));
  const allFriends = friends.data?.pages.flatMap((page) => page.items) ?? [];
  const remaining = allFriends.filter((f) => !closeIds.has(f.user.id));

  return (
    <div className="flex flex-col gap-6">
      <p className="px-3 text-sm text-fg-muted">
        Close friends see your close-friends-only statuses; no one is notified when you add or
        remove them.
      </p>
      <section aria-label="Your close friends">
        <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
          Close friends
        </h2>
        {(closeFriends.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon="💚"
            title="No close friends yet"
            description="Add friends below to share close-friends-only statuses with them."
          />
        ) : (
          closeFriends.data?.items.map((entry) => (
            <UserCard
              key={entry.user.id}
              user={entry.user}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={removeCloseFriend.isPending}
                  onClick={() => void removeCloseFriend.mutateAsync(entry.user.id)}
                >
                  Remove
                </Button>
              }
            />
          ))
        )}
      </section>
      {remaining.length > 0 && (
        <section aria-label="Add a close friend">
          <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
            Add from your friends
          </h2>
          {remaining.map((friend) => (
            <UserCard
              key={friend.user.id}
              user={friend.user}
              action={
                <Button
                  size="sm"
                  loading={addCloseFriend.isPending}
                  onClick={() => void addCloseFriend.mutateAsync(friend.user.id)}
                >
                  Add
                </Button>
              }
            />
          ))}
        </section>
      )}
    </div>
  );
}
