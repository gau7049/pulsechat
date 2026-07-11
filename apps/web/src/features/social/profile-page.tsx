import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Modal } from '../../components/ui/modal';
import { Skeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api';
import { RelationshipButton } from './relationship-button';
import { useBlockUser, usePublicProfile, useRemoveFriend, useUnblockUser } from './use-social';

/** Public profile view (§7–8): what's shown is decided server-side. */
export function ProfilePage() {
  const { username = '' } = useParams();
  const profile = usePublicProfile(username);

  if (profile.isLoading) return <ProfileSkeleton />;
  if (profile.isError || !profile.data) {
    const notFound = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <EmptyState
          icon={notFound ? '🕳️' : '⚠️'}
          title={notFound ? 'User not found' : 'Could not load this profile'}
          description={
            notFound
              ? 'This account does not exist or is not available.'
              : 'Check your connection and try again.'
          }
          action={
            notFound ? (
              <Button variant="secondary" onClick={() => window.history.back()}>
                Go back
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void profile.refetch()}>
                Retry
              </Button>
            )
          }
        />
      </main>
    );
  }

  const { user, relationship, details, stats, mutualCount } = profile.data;
  const isSelf = relationship === 'self';

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <section className="rounded-2xl border border-border bg-surface-raised p-6">
        <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-start sm:text-left">
          <Avatar name={user.displayName} src={user.avatarUrl} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold text-fg">{user.displayName}</h1>
            <p className="text-sm text-fg-muted">
              @{user.username}
              {!isSelf && typeof mutualCount === 'number' && mutualCount > 0
                ? ` · ${mutualCount} mutual friend${mutualCount === 1 ? '' : 's'}`
                : ''}
            </p>
            {details?.bio && (
              <p className="mt-3 text-sm whitespace-pre-wrap text-fg">{details.bio}</p>
            )}
            {details && (details.country || details.state) && (
              <p className="mt-1 text-xs text-fg-muted">
                {[details.state, details.country].filter(Boolean).join(', ')}
              </p>
            )}
            {details?.email && <p className="mt-1 text-xs text-fg-muted">{details.email}</p>}
            {details?.birthDate && (
              <p className="mt-1 text-xs text-fg-muted">
                Born {new Date(details.birthDate).toLocaleDateString()}
              </p>
            )}
            {details && (
              <p className="mt-1 text-xs text-fg-muted">
                Joined {new Date(details.memberSince).toLocaleDateString()}
              </p>
            )}
          </div>
          <ProfileActions profileData={profile.data} />
        </div>

        {stats ? (
          <dl className="mt-6 grid grid-cols-3 divide-x divide-border rounded-xl bg-surface-sunken py-3 text-center">
            <Stat label="Posts" value={stats.posts} />
            <Stat label="Friends" value={stats.friends} />
            <Stat label="Pending sent" value={stats.pendingSent} />
          </dl>
        ) : (
          <p className="mt-6 rounded-xl bg-surface-sunken px-4 py-3 text-center text-sm text-fg-muted">
            {relationship === 'blocked'
              ? 'You blocked this user. Unblock them to interact again.'
              : 'This profile is private. Become friends to see more.'}
          </p>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-lg font-bold text-fg">{value}</dd>
    </div>
  );
}

function ProfileActions({
  profileData,
}: {
  profileData: NonNullable<ReturnType<typeof usePublicProfile>['data']>;
}) {
  const { user, relationship, canSendRequest, requestId } = profileData;
  const navigate = useNavigate();
  const { toast } = useToast();
  const removeFriend = useRemoveFriend();
  const block = useBlockUser();
  const unblock = useUnblockUser();
  const [confirming, setConfirming] = useState<'remove' | 'block' | null>(null);

  function onError(error: unknown) {
    toast(error instanceof ApiError ? error.message : 'Something went wrong', { kind: 'error' });
  }

  if (relationship === 'self') {
    return (
      <Button variant="secondary" size="sm" onClick={() => navigate('/settings/profile')}>
        Edit profile
      </Button>
    );
  }
  if (relationship === 'blocked') {
    return (
      <Button
        variant="secondary"
        size="sm"
        loading={unblock.isPending}
        onClick={() => unblock.mutate(user.id, { onError })}
      >
        Unblock
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col items-stretch gap-2">
      <RelationshipButton
        userId={user.id}
        relationship={relationship}
        canSendRequest={canSendRequest}
        requestId={requestId}
      />
      {relationship === 'friends' && (
        <Button variant="ghost" size="sm" onClick={() => setConfirming('remove')}>
          Remove friend
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => setConfirming('block')}>
        Block
      </Button>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={
          confirming === 'remove' ? `Remove ${user.displayName}?` : `Block ${user.displayName}?`
        }
      >
        <p className="text-sm text-fg-muted">
          {confirming === 'remove'
            ? 'You will no longer be friends. You can send a new request later.'
            : 'They will no longer find you in search, view your profile, or message you. They are not notified.'}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={removeFriend.isPending || block.isPending}
            onClick={() => {
              const action = confirming === 'remove' ? removeFriend : block;
              action.mutate(user.id, {
                onError,
                onSuccess: () => setConfirming(null),
              });
            }}
          >
            {confirming === 'remove' ? 'Remove friend' : 'Block user'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8" aria-busy>
      <div className="rounded-2xl border border-border bg-surface-raised p-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <Skeleton className="size-24 rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
        <Skeleton className="mt-6 h-16 w-full rounded-xl" />
      </div>
    </main>
  );
}
