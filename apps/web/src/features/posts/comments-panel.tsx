import { useState, type FormEvent } from 'react';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { useToast } from '../../components/ui/toast';
import { PostText } from './post-text';
import { useComments, useCreateComment, useToggleCommentLike } from './use-posts';

/** Comment thread + composer for a single post (§13.5, comment likes §24.6). */
export function CommentsPanel({ postId }: { postId: string }) {
  const { toast } = useToast();
  const comments = useComments(postId);
  const createComment = useCreateComment(postId);
  const toggleLike = useToggleCommentLike();
  const [draft, setDraft] = useState('');

  const items = comments.data?.pages.flatMap((page) => page.items) ?? [];

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    try {
      await createComment.mutateAsync(body);
    } catch (error) {
      setDraft(body);
      toast(error instanceof Error ? error.message : 'Could not post the comment', {
        kind: 'error',
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {!comments.isLoading && items.length === 0 && (
        <EmptyState
          icon="💬"
          title="No comments yet"
          description="Be the first to say something."
        />
      )}
      {items.map((comment) => (
        <div key={comment.id} className="flex items-start gap-3">
          <Avatar name={comment.user.displayName} src={comment.user.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="text-fg">
              <span className="font-semibold">{comment.user.displayName} </span>
              <PostText text={comment.body} />
            </p>
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              {new Date(comment.createdAt).toLocaleString()}
              <button
                type="button"
                aria-label={comment.likedByMe ? 'Unlike comment' : 'Like comment'}
                onClick={() => toggleLike.mutate(comment.id)}
                className={comment.likedByMe ? 'font-semibold text-danger' : 'hover:text-fg'}
              >
                {comment.likedByMe ? '❤️' : '🤍'}
                {comment.likeCount > 0 && ` ${comment.likeCount}`}
              </button>
            </p>
          </div>
        </div>
      ))}
      {comments.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="sm"
            loading={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            Show more
          </Button>
        </div>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex gap-2 border-t border-border pt-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          className="h-10 flex-1 rounded-xl border border-border bg-surface-raised px-3 text-sm text-fg placeholder:text-fg-muted focus:border-accent"
        />
        <Button type="submit" size="sm" loading={createComment.isPending} disabled={!draft.trim()}>
          Post
        </Button>
      </form>
    </div>
  );
}
