import { NavLink } from 'react-router-dom';
import type { ConversationDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { useAuth } from '../auth/auth-context';
import { conversationTitle, otherMember } from './conversation-utils';
import { useDecryptedMessage } from './use-decrypted-message';

/** The chat list (§14.1): unread badges and last-message previews, live. */
export function ConversationList({ conversations }: { conversations: ConversationDto[] }) {
  return (
    <nav aria-label="Conversations" className="flex flex-col">
      {conversations.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} />
      ))}
    </nav>
  );
}

function ConversationRow({ conversation }: { conversation: ConversationDto }) {
  const { user } = useAuth();
  if (!user) return null;
  return <ConversationRowInner conversation={conversation} myId={user.id} />;
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
          <span className="truncate text-sm font-medium text-fg">{title}</span>
          <span className="shrink-0 text-[10px] text-fg-muted">
            {new Date(when).toLocaleDateString() === new Date().toLocaleDateString()
              ? new Date(when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date(when).toLocaleDateString()}
          </span>
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-fg-muted">
            {conversation.lastMessage
              ? preview.state === 'ok'
                ? preview.text
                : '🔒 Encrypted message'
              : 'No messages yet'}
          </span>
          {conversation.unreadCount > 0 && (
            <span
              aria-label={`${conversation.unreadCount} unread`}
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-on-accent"
            >
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          )}
        </span>
      </span>
    </NavLink>
  );
}
