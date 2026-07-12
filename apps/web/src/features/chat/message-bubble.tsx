import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import type { ConversationDto, MessageDto } from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Skeleton } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api';
import { UserCard } from '../social/user-card';
import { ackEmitter, getAckVersion, liveAggregate } from './chat-live-store';
import { LinkifiedText } from './linkified-text';
import { isSingleEmoji, parseEnvelope, type MessageEnvelope } from './message-envelope';
import { useDecryptedMessage, type DecryptState } from './use-decrypted-message';
import { useDeleteMessage, useMessageStatuses, useToggleReaction, useToggleStar } from './use-chat';

/**
 * One chat bubble (§14.1–14.7): typed decrypted content, live ticks,
 * reactions, reply quote, and the message action menu.
 */

export type BubbleState = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

const TICKS: Record<BubbleState, { label: string; symbol: string; accent: boolean }> = {
  pending: { label: 'Sending', symbol: '🕓', accent: false },
  failed: { label: 'Failed to send', symbol: '!', accent: false },
  sent: { label: 'Sent', symbol: '✓', accent: false },
  delivered: { label: 'Delivered', symbol: '✓✓', accent: false },
  read: { label: 'Read', symbol: '✓✓', accent: true },
};

function StatusTick({ state }: { state: BubbleState }) {
  const tick = TICKS[state];
  return (
    <span
      role="img"
      aria-label={tick.label}
      title={tick.label}
      className={`text-[10px] leading-none ${
        state === 'failed' ? 'font-bold text-danger' : tick.accent ? 'text-accent' : 'opacity-70'
      }`}
    >
      {tick.symbol}
    </span>
  );
}

export interface BubbleActions {
  onReply?: (message: MessageDto) => void;
  onEdit?: (message: MessageDto, currentText: string) => void;
  onForward?: (message: MessageDto) => void;
  onQuoteClick?: (messageId: string) => void;
}

export function MessageBubble({
  userId,
  conversation,
  message,
  repliedMessage,
  localState,
  onRetry,
  actions = {},
}: {
  userId: string;
  conversation: ConversationDto;
  message: MessageDto;
  /** The quoted original, when loaded (§14.5). */
  repliedMessage?: MessageDto;
  localState?: 'pending' | 'failed';
  onRetry?: () => void;
  actions?: BubbleActions;
}) {
  const own = message.senderId === userId;
  const deleted = message.deletedForEveryoneAt !== null;
  const decrypted = useDecryptedMessage(userId, conversation, deleted ? null : message);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  useSyncExternalStore(ackEmitter.subscribe, getAckVersion);
  const recipients = conversation.members
    .filter((m) => m.user.id !== message.senderId)
    .map((m) => m.user.id);
  const live = own ? liveAggregate(conversation.id, message.sequence, recipients) : null;
  const state: BubbleState =
    localState ??
    (live === 'read'
      ? 'read'
      : live === 'delivered' && message.aggregateState !== 'read'
        ? 'delivered'
        : (message.aggregateState ?? 'sent'));

  const sender = conversation.members.find((m) => m.user.id === message.senderId);
  const envelope = decrypted.state === 'ok' ? parseEnvelope(decrypted.text) : null;
  const canInspect = own && conversation.type === 'group' && !localState && !deleted;
  const isSticker = envelope?.type === 'sticker';
  const isBigEmoji =
    envelope?.type === 'text' && isSingleEmoji(envelope.text) && !message.replyToId;
  const plainBubble = isSticker || isBigEmoji;

  return (
    <div
      data-message-id={message.id}
      className={`group flex items-end gap-1 ${own ? 'justify-end' : 'justify-start'}`}
    >
      {!deleted && !localState && (
        <MessageMenu
          own={own}
          message={message}
          conversation={conversation}
          userId={userId}
          envelope={envelope}
          open={showMenu}
          setOpen={setShowMenu}
          actions={actions}
          side={own ? 'left' : 'right'}
        />
      )}

      <div className={`flex max-w-[78%] flex-col ${own ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
            plainBubble
              ? 'bg-transparent px-1 shadow-none'
              : own
                ? 'rounded-br-md bg-accent text-on-accent'
                : 'rounded-bl-md border border-border bg-surface-raised text-fg'
          }`}
        >
          {!own && conversation.type === 'group' && !plainBubble && (
            <p className="mb-0.5 text-xs font-semibold text-accent">
              {sender?.user.displayName ?? 'Former member'}
            </p>
          )}

          {message.forwardedFromId && !deleted && (
            <p
              className={`mb-0.5 text-[10px] italic ${own && !plainBubble ? 'text-on-accent/70' : 'text-fg-muted'}`}
            >
              ↪ Forwarded
            </p>
          )}

          {message.replyToId && !deleted && (
            <ReplyQuote
              userId={userId}
              conversation={conversation}
              original={repliedMessage}
              own={own}
              onClick={() => message.replyToId && actions.onQuoteClick?.(message.replyToId)}
            />
          )}

          {deleted ? (
            <p className="text-xs italic opacity-70">🚫 This message was deleted</p>
          ) : (
            <BubbleContent decrypted={decrypted} envelope={envelope} bigEmoji={isBigEmoji} />
          )}

          <span
            className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
              own && !plainBubble ? 'text-on-accent/80' : 'text-fg-muted'
            }`}
          >
            {message.starred && (
              <span role="img" aria-label="Starred" className="text-[9px]">
                ★
              </span>
            )}
            {message.editedAt && !deleted && <span className="italic">edited</span>}
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
            {own &&
              !deleted &&
              (canInspect ? (
                <button
                  type="button"
                  onClick={() => setShowBreakdown(true)}
                  aria-label="View delivery details"
                  className="rounded px-0.5 hover:bg-black/10"
                >
                  <StatusTick state={state} />
                </button>
              ) : (
                <StatusTick state={state} />
              ))}
            {localState === 'failed' && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-1 rounded bg-black/15 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-black/25"
              >
                Retry
              </button>
            )}
          </span>
        </div>

        {message.reactions.length > 0 && !deleted && (
          <ReactionChips message={message} conversation={conversation} userId={userId} />
        )}
      </div>

      {canInspect && showBreakdown && (
        <BreakdownModal messageId={message.id} onClose={() => setShowBreakdown(false)} />
      )}
    </div>
  );
}

// ── Content by envelope type (§14.4, §14.8) ──────────────────────────────────

function BubbleContent({
  decrypted,
  envelope,
  bigEmoji,
}: {
  decrypted: DecryptState;
  envelope: MessageEnvelope | null;
  bigEmoji: boolean;
}) {
  if (decrypted.state === 'loading') return <Skeleton className="h-4 w-32" />;
  if (decrypted.state === 'locked') {
    return <p className="italic opacity-70">🔒 Unlock your keys to read this message</p>;
  }
  if (decrypted.state === 'unreadable' || !envelope) {
    return <p className="italic opacity-70">⚠️ Can't decrypt this message on this device</p>;
  }

  switch (envelope.type) {
    case 'sticker':
      return (
        <span role="img" aria-label="Sticker" className="block text-6xl leading-tight">
          {envelope.emoji}
        </span>
      );
    case 'text':
      return bigEmoji ? (
        <span role="img" aria-label={envelope.text} className="block text-5xl leading-tight">
          {envelope.text.trim()}
        </span>
      ) : (
        <LinkifiedText text={envelope.text} />
      );
    case 'image':
      return (
        <span className="block">
          <img
            src={envelope.attachment.url}
            alt={envelope.attachment.name}
            loading="lazy"
            className="max-h-72 max-w-full rounded-lg object-contain"
          />
          {envelope.text && (
            <span className="mt-1 block">
              <LinkifiedText text={envelope.text} />
            </span>
          )}
        </span>
      );
    case 'video':
      return (
        <video src={envelope.attachment.url} controls className="max-h-72 max-w-full rounded-lg">
          <track kind="captions" />
        </video>
      );
    case 'audio':
      return <audio src={envelope.attachment.url} controls className="max-w-full" />;
    case 'document':
      return (
        <a
          href={envelope.attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          download={envelope.attachment.name}
          className="flex items-center gap-2 rounded-lg bg-black/10 px-3 py-2 hover:bg-black/20"
        >
          <span aria-hidden className="text-xl">
            📄
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{envelope.attachment.name}</span>
            <span className="block text-[10px] opacity-70">
              {(envelope.attachment.size / 1024).toFixed(0)} KB
            </span>
          </span>
        </a>
      );
    case 'post-share':
      return (
        <Link
          to={`/p/${envelope.post.postId}`}
          className="block overflow-hidden rounded-lg border border-white/20"
        >
          <img src={envelope.post.mediaUrl} alt="" className="max-h-56 w-full object-cover" />
          <span className="block px-2 py-1.5 text-xs">
            <span className="font-semibold">{envelope.post.authorDisplayName}</span>
            {envelope.post.caption && (
              <span className="mt-0.5 block truncate opacity-80">{envelope.post.caption}</span>
            )}
          </span>
        </Link>
      );
  }
}

// ── Reply quote (§14.5) ──────────────────────────────────────────────────────

function ReplyQuote({
  userId,
  conversation,
  original,
  own,
  onClick,
}: {
  userId: string;
  conversation: ConversationDto;
  original?: MessageDto;
  own: boolean;
  onClick: () => void;
}) {
  const decrypted = useDecryptedMessage(userId, conversation, original ?? null);
  const senderName =
    original &&
    (original.senderId === userId
      ? 'You'
      : (conversation.members.find((m) => m.user.id === original.senderId)?.user.displayName ??
        'Former member'));
  let preview = '…';
  if (original?.deletedForEveryoneAt) preview = 'Deleted message';
  else if (decrypted.state === 'ok') {
    const envelope = parseEnvelope(decrypted.text);
    preview =
      envelope.type === 'text'
        ? envelope.text
        : envelope.type === 'sticker'
          ? `${envelope.emoji} Sticker`
          : envelope.type === 'post-share'
            ? '📤 Shared post'
            : `📎 ${envelope.type}`;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Go to the original message"
      className={`mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs ${
        own
          ? 'border-on-accent/60 bg-black/15 text-on-accent/90'
          : 'border-accent bg-surface-sunken text-fg-muted'
      }`}
    >
      <span className="block font-semibold">{senderName ?? 'Original message'}</span>
      <span className="block truncate">{preview}</span>
    </button>
  );
}

// ── Reactions (§14.4) ────────────────────────────────────────────────────────

function ReactionChips({
  message,
  conversation,
  userId,
}: {
  message: MessageDto;
  conversation: ConversationDto;
  userId: string;
}) {
  const toggle = useToggleReaction(conversation.id, userId);
  const grouped = new Map<string, number>();
  for (const reaction of message.reactions) {
    grouped.set(reaction.emoji, (grouped.get(reaction.emoji) ?? 0) + 1);
  }
  const mine = message.reactions.find((r) => r.userId === userId)?.emoji;

  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {[...grouped.entries()].map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => toggle.mutate({ messageId: message.id, emoji })}
          aria-label={`${emoji} ${count}`}
          className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
            mine === emoji
              ? 'border-accent bg-accent-soft'
              : 'border-border bg-surface-raised hover:bg-surface-sunken'
          }`}
        >
          {emoji}
          {count > 1 && <span className="text-[10px] text-fg-muted">{count}</span>}
        </button>
      ))}
    </span>
  );
}

// ── Action menu (§14.3–14.6) ─────────────────────────────────────────────────

function MessageMenu({
  own,
  message,
  conversation,
  userId,
  envelope,
  open,
  setOpen,
  actions,
  side,
}: {
  own: boolean;
  message: MessageDto;
  conversation: ConversationDto;
  userId: string;
  envelope: MessageEnvelope | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  actions: BubbleActions;
  side: 'left' | 'right';
}) {
  const { toast } = useToast();
  const react = useToggleReaction(conversation.id, userId);
  const star = useToggleStar(conversation.id);
  const remove = useDeleteMessage(conversation.id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function onError(error: unknown) {
    toast(error instanceof ApiError ? error.message : 'Something went wrong', { kind: 'error' });
  }

  return (
    <div className="relative self-center">
      <button
        type="button"
        aria-label="Message actions"
        title="Message actions"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-full px-1.5 py-0.5 text-sm text-fg-muted opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-surface-sunken"
      >
        ⋯
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className={`absolute bottom-full z-40 mb-1 w-44 rounded-xl border border-border bg-surface-raised p-1 shadow-lg ${
              side === 'left' ? 'right-0' : 'left-0'
            }`}
          >
            <div className="flex justify-between px-1 pb-1">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => {
                    react.mutate({ messageId: message.id, emoji }, { onError });
                    setOpen(false);
                  }}
                  className="rounded-lg p-1 text-base hover:bg-surface-sunken"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <MenuItem
              label="Reply"
              onClick={() => {
                actions.onReply?.(message);
                setOpen(false);
              }}
            />
            <MenuItem
              label="Forward"
              onClick={() => {
                actions.onForward?.(message);
                setOpen(false);
              }}
            />
            <MenuItem
              label={message.starred ? 'Unstar' : 'Star'}
              onClick={() => {
                star.mutate(message.id, { onError });
                setOpen(false);
              }}
            />
            {own && envelope?.type === 'text' && (
              <MenuItem
                label="Edit"
                onClick={() => {
                  actions.onEdit?.(message, envelope.text);
                  setOpen(false);
                }}
              />
            )}
            <MenuItem
              label="Delete…"
              danger
              onClick={() => {
                setConfirmingDelete(true);
                setOpen(false);
              }}
            />
          </div>
        </>
      )}

      {confirmingDelete && (
        <Modal open onClose={() => setConfirmingDelete(false)} title="Delete message?">
          <p className="text-sm text-fg-muted">
            "Delete for me" only hides it from your view.
            {own && ' "Delete for everyone" removes it for all members.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              loading={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { messageId: message.id, scope: 'me' },
                  { onError, onSuccess: () => setConfirmingDelete(false) },
                )
              }
            >
              Delete for me
            </Button>
            {own && (
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() =>
                  remove.mutate(
                    { messageId: message.id, scope: 'everyone' },
                    { onError, onSuccess: () => setConfirmingDelete(false) },
                  )
                }
              >
                Delete for everyone
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-sunken ${
        danger ? 'text-danger' : 'text-fg'
      }`}
    >
      {label}
    </button>
  );
}

/** §14.2 group per-member delivery breakdown (sender only). */
function BreakdownModal({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const statuses = useMessageStatuses(messageId);
  return (
    <Modal open onClose={onClose} title="Delivery details">
      {statuses.isLoading && <Skeleton className="h-16 w-full" />}
      {statuses.isError && <p className="text-sm text-danger">Could not load delivery details.</p>}
      {statuses.data && (
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {statuses.data.items.map((row) => (
            <UserCard
              key={row.user.id}
              user={row.user}
              subtitle={
                row.state === 'read'
                  ? `Read ${new Date(row.updatedAt!).toLocaleString()}`
                  : row.state
                    ? 'Delivered'
                    : 'Not yet notified'
              }
              action={
                <span aria-hidden className="text-xs">
                  {row.state === 'read' ? '✓✓' : row.state ? '✓' : '·'}
                </span>
              }
            />
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
