import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FriendDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { generateContentKey, wrapKeyFor } from '../../lib/crypto/conversation-keys';
import { useAuth } from '../auth/auth-context';
import { useFriends } from '../social/use-social';
import { useCreateConversation } from './use-chat';

/**
 * Start a chat (§14.1/§14.2): pick one friend for a direct conversation or
 * several plus a name for a group. The content key is generated here and
 * sealed per member before anything reaches the server (Technical Spec §6).
 */
export function NewChatModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const friendsQuery = useFriends();
  const create = useCreateConversation();

  const [selected, setSelected] = useState<Map<string, FriendDto>>(new Map());
  const [groupName, setGroupName] = useState('');
  const friends = friendsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const isGroup = selected.size > 1;

  function toggle(friend: FriendDto): void {
    if (!friend.publicKey) {
      toast(`${friend.user.displayName} has no encryption keys yet`, { kind: 'error' });
      return;
    }
    const next = new Map(selected);
    if (next.has(friend.user.id)) next.delete(friend.user.id);
    else next.set(friend.user.id, friend);
    setSelected(next);
  }

  async function start(): Promise<void> {
    if (!user?.publicKey) {
      toast('Your account has no encryption keys on record', { kind: 'error' });
      return;
    }
    const chosen = [...selected.values()];
    try {
      const contentKey = await generateContentKey();
      const members = await Promise.all(
        chosen.map(async (friend) => ({
          userId: friend.user.id,
          wrappedKey: await wrapKeyFor(friend.publicKey!, contentKey),
        })),
      );
      const myWrappedKey = await wrapKeyFor(user.publicKey!, contentKey);
      const result = await create.mutateAsync({
        type: isGroup ? 'group' : 'direct',
        ...(isGroup ? { name: groupName.trim() } : {}),
        members,
        myWrappedKey,
      });
      onClose();
      navigate(`/chats/${result.conversation.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not start the conversation', {
        kind: 'error',
      });
    }
  }

  const startDisabled = selected.size === 0 || (isGroup && groupName.trim().length === 0);

  return (
    <Modal open onClose={onClose} title="New chat">
      <div className="flex max-h-[60vh] flex-col gap-3">
        {isGroup && (
          <Input
            label="Group name"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Weekend crew"
            required
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
          {friendsQuery.isLoading && (
            <div aria-hidden>
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}
          {!friendsQuery.isLoading && friends.length === 0 && (
            <EmptyState
              icon="🤝"
              title="No friends yet"
              description="Chat needs an accepted friendship first — find people on the People page."
            />
          )}
          {friends.map((friend) => {
            const checked = selected.has(friend.user.id);
            return (
              <label
                key={friend.user.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-sunken"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(friend)}
                  className="size-4 accent-(--accent)"
                  aria-label={`Select ${friend.user.displayName}`}
                />
                <Avatar name={friend.user.displayName} src={friend.user.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{friend.user.displayName}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    @{friend.user.username}
                    {!friend.publicKey && ' · no encryption keys'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={startDisabled} onClick={() => void start()}>
            {isGroup ? 'Create group' : 'Start chat'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
