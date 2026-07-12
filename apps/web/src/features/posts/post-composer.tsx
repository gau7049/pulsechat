import { useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';
import { ImageAnnotator } from '../annotate/image-annotator';
import { uploadAttachment } from '../chat/attachments';
import { useCreatePost } from './use-posts';

const HASHTAG_PATTERN = /#(\w+)/g;

/**
 * New-post composer (§13.1) — the "prominent center control" in the main
 * nav. A photo is required (schema: one image per post, no carousel);
 * hashtags are parsed live from the caption for a preview, but only indexed
 * server-side when the author's profile is public (§13.3).
 */
export function PostComposer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const create = useCreatePost();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [caption, setCaption] = useState('');
  const [picked, setPicked] = useState<File | null>(null);
  const [annotating, setAnnotating] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const hashtags = useMemo(
    () => [...new Set([...caption.matchAll(HASHTAG_PATTERN)].map((m) => m[1]!.toLowerCase()))],
    [caption],
  );
  const isPublic = user?.visibility === 'public';

  async function handleSubmit(): Promise<void> {
    if (!picked) {
      toast('Add a photo first', { kind: 'error' });
      return;
    }
    try {
      setUploading(true);
      const attachment = await uploadAttachment(picked, 'image');
      await create.mutateAsync({
        mediaUrl: attachment.url,
        ...(caption.trim() ? { caption: caption.trim() } : {}),
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
            📷 Choose a photo
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
