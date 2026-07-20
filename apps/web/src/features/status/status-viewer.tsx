import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STATUS_MUSIC_TRACKS,
  type StatusDto,
  type StatusFeedEntryDto,
  type UserSummaryDto,
} from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { handleImageError } from '../../lib/image-fallback';
import { useAuth } from '../auth/auth-context';
import { generateContentKey, wrapKeyFor } from '../../lib/crypto/conversation-keys';
import { serializeEnvelope } from '../chat/message-envelope';
import { useConversations, useCreateConversation, useSendToConversation } from '../chat/use-chat';
import { useFriends } from '../social/use-social';
import { useDeleteStatus, usePollResults, useReactToStatus, useRespondToPoll } from './use-status';

const AUTO_ADVANCE_MS = 6000;
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥'];

/**
 * Full-screen status viewer (Requirement Scope §11): tap-through between a
 * user's active statuses, auto-advancing like a story. `entries` is the
 * whole rail so ◀/▶ at the ends can move to the neighbouring person.
 */
export function StatusViewer({
  entries,
  startIndex,
  onClose,
}: {
  entries: StatusFeedEntryDto[];
  startIndex: number;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const deleteStatus = useDeleteStatus();
  const [personIndex, setPersonIndex] = useState(startIndex);
  const [statusIndex, setStatusIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  const person = entries[personIndex];
  const statuses = person?.statuses ?? [];
  const status = statuses[statusIndex];
  const track = useMemo(
    () => STATUS_MUSIC_TRACKS.find((t) => t.id === status?.musicTrackId) ?? null,
    [status],
  );

  useEffect(() => {
    setStatusIndex(0);
  }, [personIndex]);

  const advance = useCallback((): void => {
    if (statusIndex < statuses.length - 1) {
      setStatusIndex((i) => i + 1);
    } else if (personIndex < entries.length - 1) {
      setPersonIndex((i) => i + 1);
    } else {
      onClose();
    }
  }, [statusIndex, statuses.length, personIndex, entries.length, onClose]);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(advance, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [status, advance]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (track) {
      audio.src = track.fileUrl;
      // Placeholder tracks may 404 until the real CC0 files land — that's
      // fine, the status still displays without background music.
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [track]);

  function goBack(): void {
    if (statusIndex > 0) setStatusIndex((i) => i - 1);
    else if (personIndex > 0) {
      setPersonIndex((i) => i - 1);
      setStatusIndex(0);
    }
  }

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') goBack();
      else if (event.key === 'ArrowRight') advance();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // No deps array: goBack/advance close over current index state each
    // render, so re-binding on every render is intentional.
  });

  if (!person || !status || !user) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${person.user.displayName}'s status`}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <audio ref={audioRef} hidden />
      <div className="flex gap-1 px-3 pt-3">
        {statuses.map((s, i) => (
          <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className={`h-full bg-white ${i < statusIndex ? 'w-full' : i === statusIndex ? 'w-full transition-all duration-[6000ms] ease-linear' : 'w-0'}`}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <Avatar name={person.user.displayName} src={person.user.avatarUrl} size="sm" />
        <span className="text-sm font-semibold">{person.user.displayName}</span>
        {track && <span className="text-xs text-white/60">🎵 {track.title}</span>}
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="ml-auto text-xl"
        >
          ✕
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center">
        <button
          type="button"
          aria-label="Previous"
          onClick={goBack}
          className="absolute inset-y-0 left-0 w-1/3"
        />
        <button
          type="button"
          aria-label="Next"
          onClick={advance}
          className="absolute inset-y-0 right-0 w-1/3"
        />
        {status.mediaUrl ? (
          <img
            src={status.mediaUrl}
            alt=""
            onError={handleImageError}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <p className="max-w-md px-8 text-center text-2xl font-semibold">{status.caption}</p>
        )}
      </div>

      {status.mediaUrl && status.caption && (
        <p className="px-4 pb-3 text-center text-sm">{status.caption}</p>
      )}

      {status.poll && (
        <PollBlock key={status.id} status={status} isOwner={status.userId === user.id} />
      )}

      <ReactionRow key={`react-${status.id}`} status={status} />

      {status.userId !== user.id && (
        <StoryReplyBar key={`reply-${status.id}`} owner={person.user} status={status} />
      )}

      {status.userId === user.id && (
        <button
          type="button"
          onClick={() => void deleteStatus.mutateAsync(status.id).then(onClose)}
          className="mx-auto mb-4 rounded-lg bg-white/10 px-4 py-1.5 text-sm text-white/80 hover:bg-white/20"
        >
          Delete this status
        </button>
      )}
    </div>
  );
}

// ── Reactions (§24.10) ───────────────────────────────────────────────────────

function ReactionRow({ status }: { status: StatusDto }) {
  const react = useReactToStatus();
  return (
    <div className="mb-3 flex items-center justify-center gap-2">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React with ${emoji}`}
          onClick={() => void react.mutateAsync({ statusId: status.id, body: { emoji } })}
          className={`flex size-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-110 ${
            status.myReaction === emoji ? 'bg-white/25' : 'bg-white/5'
          }`}
        >
          {emoji}
        </button>
      ))}
      {status.reactionCount > 0 && (
        <span className="text-xs text-white/70">{status.reactionCount}</span>
      )}
    </div>
  );
}

// ── Polls/questions (§24.13) ─────────────────────────────────────────────────

function PollBlock({ status, isOwner }: { status: StatusDto; isOwner: boolean }) {
  const poll = status.poll!;
  const respond = useRespondToPoll();
  const [answerText, setAnswerText] = useState('');
  const [showResults, setShowResults] = useState(false);
  const results = usePollResults(showResults ? status.id : null);

  if (isOwner) {
    return (
      <div className="mx-auto mb-3 w-full max-w-xs text-center">
        <p className="mb-2 text-sm font-medium">{poll.question}</p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setShowResults((v) => !v)}
        >
          {showResults ? 'Hide results' : 'View results'}
        </Button>
        {showResults && results.data && (
          <div className="mt-2 flex flex-col gap-1 text-left text-xs text-white/90">
            {results.data.kind === 'poll'
              ? results.data.options.map((option) => (
                  <div
                    key={option.id}
                    className="flex justify-between rounded bg-white/10 px-2 py-1"
                  >
                    <span>{option.label}</span>
                    <span>{option.count}</span>
                  </div>
                ))
              : results.data.answers.map((answer, i) => (
                  <div key={i} className="rounded bg-white/10 px-2 py-1">
                    <span className="font-medium">{answer.user.displayName}: </span>
                    {answer.answerText}
                  </div>
                ))}
          </div>
        )}
      </div>
    );
  }

  if (poll.myResponse) {
    return (
      <p className="mx-auto mb-3 max-w-xs text-center text-sm text-white/70">
        {poll.question} — thanks for responding!
      </p>
    );
  }

  return (
    <div className="mx-auto mb-3 flex w-full max-w-xs flex-col gap-2">
      <p className="text-center text-sm font-medium">{poll.question}</p>
      {poll.kind === 'poll' ? (
        <div className="flex flex-col gap-1">
          {poll.options?.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={respond.isPending}
              onClick={() =>
                void respond.mutateAsync({
                  statusId: status.id,
                  body: { selectedOptionId: option.id },
                })
              }
              className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!answerText.trim()) return;
            void respond
              .mutateAsync({ statusId: status.id, body: { answerText: answerText.trim() } })
              .then(() => setAnswerText(''));
          }}
          className="flex gap-2"
        >
          <input
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            placeholder="Type your answer…"
            className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-white/50"
          />
          <Button type="submit" size="sm" loading={respond.isPending}>
            Send
          </Button>
        </form>
      )}
    </div>
  );
}

// ── Reply (§24.10, reuses the encrypted chat pipeline like M6's post-share) ──

function StoryReplyBar({ owner, status }: { owner: UserSummaryDto; status: StatusDto }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const conversations = useConversations();
  const friends = useFriends();
  const createConversation = useCreateConversation();
  const sendTo = useSendToConversation(user!.id);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function send(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || !user) return;
    setSending(true);
    try {
      let conversation = conversations.data?.items.find(
        (c) => c.type === 'direct' && c.members.some((m) => m.user.id === owner.id),
      );
      if (!conversation) {
        const friend = friends.data?.pages
          .flatMap((page) => page.items)
          .find((f) => f.user.id === owner.id);
        if (!friend?.publicKey || !user.publicKey) {
          toast('This friend has no encryption keys yet', { kind: 'error' });
          return;
        }
        const contentKey = await generateContentKey();
        const [myWrappedKey, wrappedKey] = await Promise.all([
          wrapKeyFor(user.publicKey, contentKey),
          wrapKeyFor(friend.publicKey, contentKey),
        ]);
        const created = await createConversation.mutateAsync({
          type: 'direct',
          members: [{ userId: owner.id, wrappedKey }],
          myWrappedKey,
        });
        conversation = created.conversation;
      }
      const envelope = serializeEnvelope({
        v: 1,
        type: 'story-reply',
        story: { statusId: status.id, mediaUrl: status.mediaUrl, caption: status.caption },
        text: trimmed,
      });
      await sendTo(conversation, envelope);
      setText('');
      toast('Reply sent', { kind: 'success' });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not send the reply', {
        kind: 'error',
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="mx-auto mb-4 flex w-full max-w-sm gap-2 px-4"
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Reply to ${owner.displayName}…`}
        className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/50"
      />
      <Button type="submit" size="sm" loading={sending} disabled={!text.trim()}>
        Send
      </Button>
    </form>
  );
}
