import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../../lib/api';
import { CommentsPanel } from './comments-panel';
import { PostCard } from './post-card';
import { usePost } from './use-posts';

/** Post permalink (§13.6) — the target of external shares and the comments view. */
export function PostDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const query = usePost(id);

  if (query.isLoading || !user) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-8" aria-busy>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </main>
    );
  }
  if (query.isError || !query.data) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <EmptyState
          icon={notFound ? '🕳️' : '⚠️'}
          title={notFound ? 'Post not available' : 'Could not load this post'}
          description={
            notFound
              ? 'It may have been removed, or you may not have permission to view it.'
              : 'Check your connection and try again.'
          }
          action={
            <Button
              variant="secondary"
              onClick={() => (notFound ? window.history.back() : void query.refetch())}
            >
              {notFound ? 'Go back' : 'Retry'}
            </Button>
          }
        />
      </main>
    );
  }

  const { post } = query.data;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <PostCard userId={user.id} post={post} />
      <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
        <CommentsPanel postId={post.id} />
      </div>
    </main>
  );
}
