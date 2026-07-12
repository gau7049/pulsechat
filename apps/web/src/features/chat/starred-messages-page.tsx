import { Link } from 'react-router-dom';
import type { ConversationDto, StarredMessageDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { conversationTitle, otherMember } from './conversation-utils';
import { parseEnvelope } from './message-envelope';
import { useConversations, useStarredMessages } from './use-chat';
import { useDecryptedMessage } from './use-decrypted-message';

/**
 * Dedicated starred-messages view (§14.6): every message the caller has
 * starred, across all conversations, each linking back to its original chat.
 */
export function StarredMessagesPage() {
  const { user } = useAuth();
  const conversationsQuery = useConversations();
  const starredQuery = useStarredMessages();
  const items = starredQuery.data?.pages.flatMap((page) => page.items) ?? [];

  if (!user) return null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="flex items-center gap-2">
        <Link to="/chats" className="text-fg-muted hover:text-fg" aria-label="Back to chats">
          ←
        </Link>
        <h1 className="text-2xl font-bold text-fg">Starred messages</h1>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-2">
        {(starredQuery.isLoading || conversationsQuery.isLoading) && (
          <div aria-hidden>
            <SkeletonRow />
            <SkeletonRow />
          </div>
        )}
        {starredQuery.isError && (
          <EmptyState
            icon="⚠️"
            title="Could not load starred messages"
            action={
              <Button variant="secondary" onClick={() => void starredQuery.refetch()}>
                Retry
              </Button>
            }
          />
        )}
        {!starredQuery.isLoading && items.length === 0 && (
          <EmptyState
            icon="⭐"
            title="No starred messages yet"
            description="Star a message from its action menu to save it here."
          />
        )}
        {items.map((item) => (
          <StarredRow
            key={item.message.id}
            item={item}
            userId={user.id}
            conversation={conversationsQuery.data?.items.find(
              (c) => c.id === item.message.conversationId,
            )}
          />
        ))}
        {starredQuery.hasNextPage && (
          <div className="flex justify-center pt-2">
            <Button
              variant="ghost"
              size="sm"
              loading={starredQuery.isFetchingNextPage}
              onClick={() => void starredQuery.fetchNextPage()}
            >
              Show more
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}

function StarredRow({
  item,
  userId,
  conversation,
}: {
  item: StarredMessageDto;
  userId: string;
  conversation: ConversationDto | undefined;
}) {
  const decrypted = useDecryptedMessage(userId, conversation, conversation ? item.message : null);
  const other = conversation ? otherMember(conversation, userId) : undefined;

  let preview = '🔒 Encrypted message';
  if (!conversation) preview = 'Conversation no longer available';
  else if (item.message.deletedForEveryoneAt) preview = 'This message was deleted';
  else if (decrypted.state === 'ok') {
    const envelope = parseEnvelope(decrypted.text);
    preview =
      envelope.type === 'text'
        ? envelope.text
        : envelope.type === 'sticker'
          ? `${envelope.emoji} Sticker`
          : envelope.type === 'image'
            ? '📷 Photo'
            : envelope.type === 'video'
              ? '🎬 Video'
              : envelope.type === 'audio'
                ? '🎵 Voice message'
                : `📄 ${envelope.attachment.name}`;
  }

  const inner = (
    <div className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-sunken">
      <Avatar
        name={conversation ? conversationTitle(conversation, userId) : item.conversationLabel}
        src={conversation?.type === 'direct' ? other?.user.avatarUrl : null}
        size="sm"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-fg">{item.conversationLabel}</span>
          <span className="shrink-0 text-[10px] text-fg-muted">
            {new Date(item.starredAt).toLocaleDateString()}
          </span>
        </span>
        <span className="line-clamp-2 text-xs text-fg-muted">{preview}</span>
      </span>
      <span aria-label="Starred" className="shrink-0 text-xs">
        ★
      </span>
    </div>
  );

  return conversation ? <Link to={`/chats/${conversation.id}`}>{inner}</Link> : inner;
}
