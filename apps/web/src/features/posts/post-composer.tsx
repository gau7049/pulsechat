import { useMemo, useRef, useState } from 'react';
import type { PostAudience } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';
import { ImageAnnotator } from '../annotate/image-annotator';
import { uploadAttachment } from '../chat/attachments';
import { useFriends } from '../social/use-social';
import { useCreatePost } from './use-posts';

const HASHTAG_PATTERN = /#(\w+)/g;

const AUDIENCE_OPTIONS: Array<{ value: PostAudience; label: string }> = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'only_me', label: 'Only me' },
];

/** Mirrors the server's default (post.service.ts's `defaultAudienceFor`). */
function defaultAudienceFor(
  visibility: 'public' | 'friends' | 'private' | undefined,
): PostAudience {
  return visibility === 'public' ? 'everyone' : 'friends';
}

/**
 * New-post composer (§13.1, extended by §24.1/§24.2/§24.7) — the "prominent
 * center control" in the main nav. §24.1 relaxes the photo from required to
 * optional: a post needs a photo, a caption, or both. Hashtags are parsed
 * live from the caption for a preview, but only indexed server-side when the
 * author's profile is public (§13.3). §24.7 lets each post override the
 * account-level visibility default. §24.2 tags are picked from friends only
 * — the same friends-only rule already enforced server-side.
 */
export function PostComposer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const create = useCreatePost();
  const friends = useFriends();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [caption, setCaption] = useState('');
  const [picked, setPicked] = useState<File | null>(null);
  const [annotating, setAnnotating] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [audience, setAudience] = useState<PostAudience>(() =>
    defaultAudienceFor(user?.visibility),
  );
  const [taggedUserIds, setTaggedUserIds] = useState<string[]>([]);
  const [tagging, setTagging] = useState(false);

  const hashtags = useMemo(
    () => [...new Set([...caption.matchAll(HASHTAG_PATTERN)].map((m) => m[1]!.toLowerCase()))],
    [caption],
  );
  const isPublic = user?.visibility === 'public';
  const friendList = friends.data?.pages.flatMap((page) => page.items) ?? [];
  const taggedNames = friendList
    .filter((f) => taggedUserIds.includes(f.user.id))
    .map((f) => f.user.displayName);

  async function handleSubmit(): Promise<void> {
    if (!picked && !caption.trim()) {
      toast('Add a photo or write a caption', { kind: 'error' });
      return;
    }
    try {
      setUploading(true);
      const mediaUrl = picked ? (await uploadAttachment(picked, 'image')).url : undefined;
      await create.mutateAsync({
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        audience,
        ...(taggedUserIds.length > 0 ? { taggedUserIds } : {}),
      });
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not create the post', {
        kind: 'error',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New post">
      <div className="flex flex-col gap-3">
        {picked ? (
          <div className="relative">
            <img
              src={URL.createObjectURL(picked)}
              alt="Post preview"
              className="max-h-64 w-full rounded-xl object-cover"
            />
            <button
              type="button"
              aria-label="Remove photo"
              title="Remove photo"
              onClick={() => setPicked(null)}
              className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white"
            >
              ✕
            </button>
          </div>
        ) : (
          <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
            📷 Add a photo (optional)
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            if (file.type === 'image/gif') setPicked(file);
            else setAnnotating(file);
          }}
        />

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Write a caption… use #hashtags and @mentions"
          maxLength={2200}
          rows={3}
          className="resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent"
        />

        {hashtags.length > 0 && (
          <p className="text-xs text-fg-muted">
            {isPublic ? 'Tagged: ' : "Hashtags won't be indexed — your profile isn't public: "}
            {hashtags.map((tag) => `#${tag}`).join(' ')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            Who can see this
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as PostAudience)}
              className="rounded-lg border border-border bg-surface-raised px-2 py-1 text-xs text-fg focus:border-accent"
            >
              {AUDIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={() => setTagging(true)}>
            🏷️ {taggedUserIds.length > 0 ? `Tagged: ${taggedNames.join(', ')}` : 'Tag people'}
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            loading={uploading || create.isPending}
            onClick={() => void handleSubmit()}
          >
            Post
          </Button>
        </div>
      </div>

      {tagging && (
        <Modal open onClose={() => setTagging(false)} title="Tag friends">
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {friendList.length === 0 && (
              <p className="px-1 py-4 text-sm text-fg-muted">
                Tagging is friends-only — add some friends first.
              </p>
            )}
            {friendList.map((friend) => {
              const checked = taggedUserIds.includes(friend.user.id);
              return (
                <label
                  key={friend.user.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-sunken"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setTaggedUserIds((ids) =>
                        checked
                          ? ids.filter((id) => id !== friend.user.id)
                          : [...ids, friend.user.id],
                      )
                    }
                  />
                  <Avatar name={friend.user.displayName} src={friend.user.avatarUrl} size="sm" />
                  <span className="text-fg">{friend.user.displayName}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={() => setTagging(false)}>
              Done
            </Button>
          </div>
        </Modal>
      )}

      {annotating && (
        <ImageAnnotator
          file={annotating}
          onDone={(edited) => {
            setAnnotating(null);
            setPicked(edited);
          }}
          onCancel={() => setAnnotating(null)}
        />
      )}
    </Modal>
  );
}
