import { useState, useSyncExternalStore } from 'react';
import type { ConversationDto, MessageDto } from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { Skeleton } from '../../components/ui/skeleton';
import { ackEmitter, getAckVersion, liveAggregate } from './chat-live-store';
import { useDecryptedMessage } from './use-decrypted-message';
import { useMessageStatuses } from './use-chat';
import { UserCard } from '../social/user-card';

/**
 * One chat bubble (§14.1): decrypted body, timestamp, and — on own messages —
 * the sent/delivered/read tick that upgrades live via socket status events.
 */

export type BubbleState = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({
  userId,
  conversation,
  message,
  localState,
  onRetry,
}: {
  userId: string;
  conversation: ConversationDto;
  message: MessageDto;
  /** Overrides for outbox entries that have no server row yet. */
  localState?: 'pending' | 'failed';
  onRetry?: () => void;
}) {
  const own = message.senderId === userId;
  const decrypted = useDecryptedMessage(userId, conversation, message);
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Live tick upgrades arrive over message:status (§21.1).
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
  const canInspect = own && conversation.type === 'group' && !localState;

  return (
    <div className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
          own
            ? 'rounded-br-md bg-accent text-on-accent'
            : 'rounded-bl-md border border-border bg-surface-raised text-fg'
        }`}
      >
        {!own && conversation.type === 'group' && (
          <p className="mb-0.5 text-xs font-semibold text-accent">
            {sender?.user.displayName ?? 'Former member'}
          </p>
        )}

        {decrypted.state === 'loading' && <Skeleton className="h-4 w-32" />}
        {decrypted.state === 'ok' && (
          <p className="break-words whitespace-pre-wrap">{decrypted.text}</p>
        )}
        {decrypted.state === 'locked' && (
          <p className="italic opacity-70">🔒 Unlock your keys to read this message</p>
        )}
        {decrypted.state === 'unreadable' && (
          <p className="italic opacity-70">⚠️ Can't decrypt this message on this device</p>
        )}

        <span
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            own ? 'text-on-accent/80' : 'text-fg-muted'
          }`}
        >
          {formatTime(message.createdAt)}
          {own &&
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

      {canInspect && showBreakdown && (
        <BreakdownModal messageId={message.id} onClose={() => setShowBreakdown(false)} />
      )}
    </div>
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
