import { useState } from 'react';
import { Avatar } from '../../components/ui/avatar';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { conversationTitle, otherMember } from '../chat/conversation-utils';
import { serializeEnvelope, type PostSharePreview } from '../chat/message-envelope';
import { useConversations, useSendToConversation } from '../chat/use-chat';

/**
 * Share a post into a conversation (§13.6) — friends-only by construction,
 * same as the chat window's message-forward picker: every conversation the
 * user has is already friendship-gated.
 */
export function ShareToChatModal({
  userId,
  post,
  onClose,
}: {
  userId: string;
  post: PostSharePreview;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const conversations = useConversations();
  const sendTo = useSendToConversation(userId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const targets = (conversations.data?.items ?? []).filter((c) => !c.archived);

  return (
    <Modal open onClose={onClose} title="Share to…">
      <div className="flex max-h-80 flex-col overflow-y-auto">
        {targets.length === 0 && (
          <p className="px-2 py-4 text-sm text-fg-muted">No conversations yet.</p>
        )}
        {targets.map((target) => {
          const other = otherMember(target, userId);
          return (
            <button
              key={target.id}
              type="button"
              disabled={busyId !== null}
              onClick={() => {
                setBusyId(target.id);
                void sendTo(target, serializeEnvelope({ v: 1, type: 'post-share', post }))
                  .then(() => {
                    toast(`Shared to ${conversationTitle(target, userId)}`);
                    onClose();
                  })
                  .catch((error: unknown) => {
                    toast(error instanceof Error ? error.message : 'Could not share', {
                      kind: 'error',
                    });
                  })
                  .finally(() => setBusyId(null));
              }}
              className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-sunken disabled:opacity-50"
            >
              <Avatar
                name={conversationTitle(target, userId)}
                src={target.type === 'direct' ? (other?.user.avatarUrl ?? null) : null}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                {conversationTitle(target, userId)}
              </span>
              {busyId === target.id && (
                <span
                  aria-hidden
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
