import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { PostCard } from './post-card';
import { useSavedPosts } from './use-posts';

/** §13.5 "Saved Posts" — linked from Settings. */
export function SavedPostsPage() {
  const { user } = useAuth();
  const query = useSavedPosts();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (!user) return null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center gap-2">
        <Link to="/settings/profile" className="text-fg-muted hover:text-fg" aria-label="Back">
          ←
        </Link>
        <h1 className="text-2xl font-bold text-fg">Saved posts</h1>
      </div>

      {query.isLoading && <Skeleton className="h-96 w-full rounded-2xl" aria-hidden />}
      {query.isError && (
        <EmptyState
          icon="⚠️"
          title="Could not load saved posts"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <EmptyState icon="🔖" title="No saved posts yet" />
      )}

      {items.map((post) => (
        <PostCard key={post.id} userId={user.id} post={post} />
      ))}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}
    </main>
  );
}
