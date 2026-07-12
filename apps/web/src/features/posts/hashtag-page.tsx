import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { PostCard } from './post-card';
import { useHashtagPosts } from './use-posts';

/** §13.2 hashtag page — ranked posts from public-profile authors. */
export function HashtagPage() {
  const { tag = '' } = useParams();
  const { user } = useAuth();
  const feed = useHashtagPosts(tag);
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  if (!user) return null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">#{tag}</h1>

      {feed.isLoading && (
        <div aria-hidden className="flex flex-col gap-4">
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      )}
      {feed.isError && (
        <EmptyState
          icon="⚠️"
          title="Could not load this hashtag"
          action={
            <Button variant="secondary" onClick={() => void feed.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {!feed.isLoading && items.length === 0 && (
        <EmptyState icon="#️⃣" title="No posts yet" description={`Nobody has tagged #${tag}.`} />
      )}

      {items.map((post) => (
        <PostCard key={post.id} userId={user.id} post={post} />
      ))}

      {feed.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            loading={feed.isFetchingNextPage}
            onClick={() => void feed.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}
    </main>
  );
}
