import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api';
import { UserCard } from '../social/user-card';
import { useBlockedUsers, useUnblockUser } from '../social/use-social';

/** Blocked accounts manager (§10.2) — review and unblock. */
export function BlockedSection() {
  const { toast } = useToast();
  const blocked = useBlockedUsers();
  const unblock = useUnblockUser();

  if (blocked.isLoading) {
    return (
      <div aria-hidden>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (blocked.isError) {
    return (
      <EmptyState
        icon="⚠️"
        title="Could not load blocked users"
        action={
          <Button variant="secondary" onClick={() => void blocked.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const items = blocked.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon="🚫"
        title="No blocked users"
        description="People you block can no longer find you, view your profile, or message you."
      />
    );
  }

  return (
    <div className="flex flex-col" role="list" aria-label="Blocked users">
      {items.map((entry) => (
        <UserCard
          key={entry.user.id}
          user={entry.user}
          subtitle={`Blocked ${new Date(entry.blockedAt).toLocaleDateString()}`}
          action={
            <Button
              variant="secondary"
              size="sm"
              loading={unblock.isPending && unblock.variables === entry.user.id}
              onClick={() =>
                unblock.mutate(entry.user.id, {
                  onError: (error) =>
                    toast(error instanceof ApiError ? error.message : 'Something went wrong', {
                      kind: 'error',
                    }),
                })
              }
            >
              Unblock
            </Button>
          }
        />
      ))}
    </div>
  );
}
