import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { PostDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { ProgressiveImage } from '../../components/ui/progressive-image';
import { useToast } from '../../components/ui/toast';
import { ReportModal } from '../reports/report-modal';
import { PostText } from './post-text';
import { ShareToChatModal } from './share-to-chat-modal';
import { useDeletePost, useRemoveMyTag, useToggleLike, useToggleSave } from './use-posts';

/** Feed/hashtag/explore card (§13). `/p/:id` carries the full detail + comments. */
export function PostCard({ userId, post }: { userId: string; post: PostDto }) {
  const { toast } = useToast();
  const like = useToggleLike();
  const save = useToggleSave();
  const deletePost = useDeletePost();
  const removeMyTag = useRemoveMyTag();
  const [sharing, setSharing] = useState<'menu' | 'chat' | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [heartPop, setHeartPop] = useState(false);

  // §13.5 like polish: pop a big heart over the image, Instagram-style,
  // whenever a like lands (not on unlike).
  function handleLikeClick(): void {
    if (!post.likedByMe) {
      setHeartPop(true);
      window.setTimeout(() => setHeartPop(false), 900);
    }
    like.mutate(post.id);
  }

  async function shareExternally(): Promise<void> {
    const url = `${window.location.origin}/p/${post.id}`;
    // §13.6: the invite note is required whenever a post is shared outside the app.
    const text = `Check out this post by @${post.author.username} on PulseChat! If the person you're sending this to isn't on the app yet, invite them — then enjoy your time and vibe!`;
    setSharing(null);
    try {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'PulseChat post', text, url });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast('Link copied to clipboard');
    } catch {
      toast('Could not share this post', { kind: 'error' });
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-surface-raised">
      <div className="flex items-center gap-3 px-4 py-3">
        <Link to={`/u/${post.author.username}`} className="flex items-center gap-3">
          <Avatar name={post.author.displayName} src={post.author.avatarUrl} size="sm" />
          <span className="text-sm font-semibold text-fg">{post.author.displayName}</span>
        </Link>
        {post.author.id === userId ? (
          <button
            type="button"
            aria-label="Delete post"
            title="Delete post"
            onClick={() => setConfirmingDelete(true)}
            className="ml-auto text-fg-muted hover:text-danger"
          >
            🗑️
          </button>
        ) : (
          <button
            type="button"
            aria-label="Report post"
            title="Report post"
            onClick={() => setReporting(true)}
            className="ml-auto text-fg-muted hover:text-danger"
          >
            🚩
          </button>
        )}
      </div>
      {reporting && (
        <ReportModal targetType="post" targetId={post.id} onClose={() => setReporting(false)} />
      )}

      <div className="relative">
        {post.mediaUrl ? (
          <Link to={`/p/${post.id}`}>
            <ProgressiveImage src={post.mediaUrl} alt="" aspectClassName="aspect-[4/5]" />
          </Link>
        ) : (
          // §24.1 text-only post — no media slot, just the caption card below.
          <Link
            to={`/p/${post.id}`}
            className="flex aspect-[4/5] items-center justify-center bg-surface-sunken px-6 text-center"
          >
            <p className="line-clamp-6 text-lg font-medium text-fg">{post.caption}</p>
          </Link>
        )}
        {heartPop && (
          <span
            aria-hidden
            className="animate-heart-pop pointer-events-none absolute inset-0 flex items-center justify-center text-8xl drop-shadow-lg"
          >
            ❤️
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 px-4 pt-3 text-lg">
        <button
          type="button"
          aria-label={post.likedByMe ? 'Unlike' : 'Like'}
          title={post.likedByMe ? 'Unlike' : 'Like'}
          onClick={handleLikeClick}
          className={post.likedByMe ? 'text-danger' : 'text-fg-muted hover:text-fg'}
        >
          {post.likedByMe ? '❤️' : '🤍'}
        </button>
        <Link
          to={`/p/${post.id}`}
          aria-label="Comments"
          title="Comments"
          className="text-fg-muted hover:text-fg"
        >
          💬
        </Link>
        <button
          type="button"
          aria-label="Share"
          title="Share"
          onClick={() => setSharing('menu')}
          className="text-fg-muted hover:text-fg"
        >
          📤
        </button>
        <button
          type="button"
          aria-label={post.savedByMe ? 'Unsave' : 'Save'}
          title={post.savedByMe ? 'Unsave' : 'Save'}
          onClick={() => save.mutate(post.id)}
          className={`ml-auto ${post.savedByMe ? 'text-accent' : 'text-fg-muted hover:text-fg'}`}
        >
          {post.savedByMe ? '🔖' : '📑'}
        </button>
      </div>

      <div className="px-4 pt-1 pb-4 text-sm">
        <p className="font-semibold text-fg">
          {post.likeCount} like{post.likeCount === 1 ? '' : 's'}
        </p>
        {post.caption && (
          <p className="mt-1 text-fg">
            <span className="font-semibold">{post.author.displayName} </span>
            <PostText text={post.caption} />
          </p>
        )}
        {post.commentCount > 0 && (
          <Link to={`/p/${post.id}`} className="mt-1 block text-fg-muted hover:text-fg">
            View all {post.commentCount} comment{post.commentCount === 1 ? '' : 's'}
          </Link>
        )}
        {post.taggedUsers.length > 0 && (
          <p className="mt-1 text-fg-muted">
            With {post.taggedUsers.map((u) => u.displayName).join(', ')}
            {post.taggedUsers.some((u) => u.id === userId) && (
              <button
                type="button"
                onClick={() => removeMyTag.mutate(post.id)}
                className="ml-2 text-xs font-medium text-accent hover:text-accent-strong"
              >
                Remove my tag
              </button>
            )}
          </p>
        )}
      </div>

      <Modal open={sharing === 'menu'} onClose={() => setSharing(null)} title="Share post">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setSharing('chat')}
            className="rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-surface-sunken"
          >
            Share to a chat
          </button>
          <button
            type="button"
            onClick={() => void shareExternally()}
            className="rounded-lg px-3 py-2 text-left text-sm text-fg hover:bg-surface-sunken"
          >
            Share externally
          </button>
        </div>
      </Modal>

      {sharing === 'chat' && (
        <ShareToChatModal
          userId={userId}
          post={{
            postId: post.id,
            mediaUrl: post.mediaUrl,
            caption: post.caption,
            authorUsername: post.author.username,
            authorDisplayName: post.author.displayName,
          }}
          onClose={() => setSharing(null)}
        />
      )}

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title="Delete post?"
      >
        <p className="text-sm text-fg-muted">This can't be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deletePost.isPending}
            onClick={() =>
              deletePost.mutate(post.id, {
                onSuccess: () => setConfirmingDelete(false),
                onError: () => toast('Could not delete this post', { kind: 'error' }),
              })
            }
          >
            Delete
          </Button>
        </div>
      </Modal>
    </article>
  );
}

/** Instagram-style square grid tile — used on the profile page. */
export function PostThumbnail({ post }: { post: PostDto }) {
  return (
    <Link to={`/p/${post.id}`} className="group block overflow-hidden rounded-lg">
      {post.mediaUrl ? (
        <ProgressiveImage
          src={post.mediaUrl}
          alt=""
          aspectClassName="aspect-square"
          imgClassName="transition-transform group-hover:scale-105"
        />
      ) : (
        <div className="flex aspect-square items-center justify-center bg-surface-sunken p-2 text-center">
          <p className="line-clamp-4 text-xs text-fg-muted">{post.caption}</p>
        </div>
      )}
    </Link>
  );
}
