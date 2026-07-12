import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { ConversationDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { useAuth } from '../auth/auth-context';
import { conversationTitle, otherMember } from './conversation-utils';
import { parseEnvelope } from './message-envelope';
import { useDecryptedMessage } from './use-decrypted-message';

/**
 * The chat list (§14.1, §14.11): unread badges and last-message previews,
 * live, grouped by pinned first; archived conversations are tucked behind a
 * disclosure so the main list stays uncluttered without ever deleting data.
 */
export function ConversationList({ conversations }: { conversations: ConversationDto[] }) {
  const [showArchived, setShowArchived] = useState(false);
  const active = conversations.filter((c) => !c.archived);
  const archived = conversations.filter((c) => c.archived);
  const pinned = active.filter((c) => c.pinned);
  const rest = active.filter((c) => !c.pinned);

  return (
    <nav aria-label="Conversations" className="flex flex-col">
      {pinned.length > 0 && (
        <>
          <SectionLabel>Pinned</SectionLabel>
          {pinned.map((conversation) => (
            <ConversationRow key={conversation.id} conversation={conversation} />
          ))}
          {rest.length > 0 && <SectionLabel>All chats</SectionLabel>}
        </>
      )}
      {rest.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} />
      ))}

      {archived.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
          >
            <span aria-hidden>{showArchived ? '▾' : '▸'}</span>
            Archived ({archived.length})
          </button>
          {showArchived &&
            archived.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} />
            ))}
        </>
      )}
    </nav>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-fg-muted uppercase">
      {children}
    </p>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationDto }) {
  const { user } = useAuth();
  if (!user) return null;
  return <ConversationRowInner conversation={conversation} myId={user.id} />;
}

function previewText(
  conversation: ConversationDto,
  preview: ReturnType<typeof useDecryptedMessage>,
): string {
  if (!conversation.lastMessage) return 'No messages yet';
  if (conversation.lastMessage.deletedForEveryoneAt) return 'This message was deleted';
  if (preview.state !== 'ok') return '🔒 Encrypted message';
  const envelope = parseEnvelope(preview.text);
  switch (envelope.type) {
    case 'text':
      return envelope.text;
    case 'sticker':
      return `${envelope.emoji} Sticker`;
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎬 Video';
    case 'audio':
      return '🎵 Voice message';
    case 'document':
      return `📄 ${envelope.attachment.name}`;
    case 'post-share':
      return '📤 Shared post';
  }
}

function ConversationRowInner({
  conversation,
  myId,
}: {
  conversation: ConversationDto;
  myId: string;
}) {
  const other = otherMember(conversation, myId);
  const title = conversationTitle(conversation, myId);
  const preview = useDecryptedMessage(myId, conversation, conversation.lastMessage);
  const when = conversation.lastMessage?.createdAt ?? conversation.createdAt;

  return (
    <NavLink
      to={`/chats/${conversation.id}`}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
          isActive ? 'bg-accent-soft' : 'hover:bg-surface-sunken'
        }`
      }
    >
      {conversation.type === 'direct' && other ? (
        <Avatar name={other.user.displayName} src={other.user.avatarUrl} online={other.online} />
      ) : (
        <Avatar name={title} />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            {conversation.pinned && (
              <span aria-label="Pinned" className="shrink-0 text-[10px] text-fg-muted">
                📌
              </span>
            )}
            <span className="truncate text-sm font-medium text-fg">{title}</span>
          </span>
          <span className="shrink-0 text-[10px] text-fg-muted">
            {new Date(when).toLocaleDateString() === new Date().toLocaleDateString()
              ? new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date(when).toLocaleDateString()}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-fg-muted">
            {previewText(conversation, preview)}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {conversation.muted && (
              <span aria-label="Muted" className="text-[10px] text-fg-muted">
                🔕
              </span>
            )}
            {conversation.unreadCount > 0 && (
              <span
                aria-label={`${conversation.unreadCount} unread`}
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  conversation.muted ? 'bg-fg-muted/40 text-fg' : 'bg-accent text-on-accent'
                }`}
              >
                {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
              </span>
            )}
          </span>
        </span>
      </span>
    </NavLink>
  );
}
