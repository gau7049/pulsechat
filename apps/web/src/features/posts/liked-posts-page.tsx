import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { PostCard } from './post-card';
import { useLikedPosts } from './use-posts';

/** §13.5 "Posts I've Liked" — linked from Settings. */
export function LikedPostsPage() {
  const { user } = useAuth();
  const query = useLikedPosts();
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (!user) return null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center gap-2">
        <Link to="/settings/profile" className="text-fg-muted hover:text-fg" aria-label="Back">
          ←
        </Link>
        <h1 className="text-2xl font-bold text-fg">Posts I've liked</h1>
      </div>

      {query.isLoading && <Skeleton className="h-96 w-full rounded-2xl" aria-hidden />}
      {!query.isLoading && items.length === 0 && (
        <EmptyState icon="🤍" title="No liked posts yet" />
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
