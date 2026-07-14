import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { PostCard } from './post-card';
import { TrendingSection } from './trending-section';
import { useExploreFeed } from './use-posts';

/**
 * §13.7 discover feed — ranked public posts. §24.3 adds a "Trending" rail
 * above the feed grid for movies/songs — a separate discovery surface from
 * this ranked post feed, never conflated with its engagement-based ranking.
 */
export function ExplorePage() {
  const { user } = useAuth();
  const feed = useExploreFeed();
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];

  if (!user) return null;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Explore</h1>

      <TrendingSection />

      {feed.isLoading && (
        <div aria-hidden className="flex flex-col gap-4">
          <Skeleton className="h-96 w-full rounded-2xl" />
          <Skeleton className="h-96 w-full rounded-2xl" />
        </div>
      )}
      {feed.isError && (
        <EmptyState
          icon="⚠️"
          title="Could not load the explore feed"
          action={
            <Button variant="secondary" onClick={() => void feed.refetch()}>
              Retry
            </Button>
          }
        />
      )}
      {!feed.isLoading && items.length === 0 && (
        <EmptyState
          icon="🧭"
          title="Nothing to explore yet"
          description="Public posts will show up here as people start sharing."
        />
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
