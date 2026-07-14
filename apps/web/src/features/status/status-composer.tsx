import { useRef, useState } from 'react';
import {
  STATUS_MUSIC_TRACKS,
  type StatusPollInput,
  type StatusVisibility,
} from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';
import { ImageAnnotator } from '../annotate/image-annotator';
import { uploadAttachment } from '../chat/attachments';
import { useCreateStatus } from './use-status';

type PollDraftKind = 'none' | 'poll' | 'question';

/**
 * New-status composer (Requirement Scope §11): photo or caption (or both),
 * optional annotation, an optional placeholder music track, and the
 * everyone/friends visibility choice — defaulted from the account's privacy
 * setting but overridable per status.
 */
export function StatusComposer({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const create = useCreateStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<StatusVisibility>(
    user?.privacy.statusVisibility ?? 'everyone',
  );
  const [musicTrackId, setMusicTrackId] = useState<string>('');
  const [picked, setPicked] = useState<File | null>(null);
  const [annotating, setAnnotating] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // §24.13 poll/question sticker.
  const [pollKind, setPollKind] = useState<PollDraftKind>('none');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);

  function buildPoll(): StatusPollInput | undefined {
    if (pollKind === 'none' || !pollQuestion.trim()) return undefined;
    if (pollKind === 'question') return { kind: 'question', question: pollQuestion.trim() };
    const options = pollOptions
      .map((label, i) => ({ id: `opt-${i}`, label: label.trim() }))
      .filter((o) => o.label.length > 0);
    if (options.length < 2) return undefined;
    return { kind: 'poll', question: pollQuestion.trim(), options };
  }

  async function handleSubmit(): Promise<void> {
    if (!picked && !caption.trim()) {
      toast('Add a photo or a caption first', { kind: 'error' });
      return;
    }
    if (pollKind !== 'none' && !buildPoll()) {
      toast(pollKind === 'poll' ? 'Add a question and at least two options' : 'Add a question', {
        kind: 'error',
      });
      return;
    }
    try {
      let mediaUrl: string | undefined;
      if (picked) {
        setUploading(true);
        const attachment = await uploadAttachment(picked, 'image');
        mediaUrl = attachment.url;
      }
      const poll = buildPoll();
      await create.mutateAsync({
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(musicTrackId ? { musicTrackId } : {}),
        ...(poll ? { poll } : {}),
        visibility,
      });
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not post the status', {
        kind: 'error',
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="New status">
      <div className="flex flex-col gap-3">
        {picked ? (
          <div className="relative">
            <img
              src={URL.createObjectURL(picked)}
              alt="Status preview"
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
            📷 Add a photo
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
          placeholder="Say something…"
          maxLength={500}
          rows={3}
          className="resize-none rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent"
        />

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Who can see this</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as StatusVisibility)}
            className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-fg"
          >
            <option value="everyone">Everyone</option>
            <option value="friends">Friends only</option>
            <option value="close_friends">Close friends</option>
          </select>
        </label>

        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">Add a sticker</span>
            <select
              value={pollKind}
              onChange={(e) => setPollKind(e.target.value as PollDraftKind)}
              className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-fg"
            >
              <option value="none">None</option>
              <option value="poll">Poll (pick one)</option>
              <option value="question">Question (ask me anything)</option>
            </select>
          </label>
          {pollKind !== 'none' && (
            <div className="flex flex-col gap-2">
              <Input
                label="Question"
                value={pollQuestion}
                onChange={(e) => setPollQuestion(e.target.value)}
                maxLength={200}
              />
              {pollKind === 'poll' &&
                pollOptions.map((option, i) => (
                  <Input
                    key={i}
                    label={`Option ${i + 1}`}
                    value={option}
                    onChange={(e) =>
                      setPollOptions((opts) => opts.map((o, j) => (j === i ? e.target.value : o)))
                    }
                    maxLength={80}
                  />
                ))}
              {pollKind === 'poll' && pollOptions.length < 6 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  onClick={() => setPollOptions((opts) => [...opts, ''])}
                >
                  + Add option
                </Button>
              )}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-fg">Background music (placeholder tracks)</span>
          <select
            value={musicTrackId}
            onChange={(e) => setMusicTrackId(e.target.value)}
            className="rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-sm text-fg"
          >
            <option value="">No music</option>
            {STATUS_MUSIC_TRACKS.map((track) => (
              <option key={track.id} value={track.id}>
                {track.title} — {track.artist}
              </option>
            ))}
          </select>
        </label>

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
