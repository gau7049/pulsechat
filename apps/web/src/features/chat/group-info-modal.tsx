import { useRef, useState } from 'react';
import type { ConversationDto, FriendDto } from '@pulsechat/shared';
import { LIMITS } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Modal } from '../../components/ui/modal';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useToast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api';
import { getConversationKey } from './chat-keys';
import { wrapKeyFor } from '../../lib/crypto/conversation-keys';
import { useFriends } from '../social/use-social';
import { uploadGroupPhoto } from './attachments';
import {
  useAddMember,
  useLeaveConversation,
  useTransferAdmin,
  useUpdateGroupPhoto,
} from './use-chat';

/**
 * WhatsApp-style group info panel: photo, full member list with roles, and
 * admin-only controls (add/remove members, transfer admin, change photo).
 * The member list itself needs no fetch — it's already on `conversation`.
 */
export function GroupInfoModal({
  conversation,
  myId,
  onClose,
}: {
  conversation: ConversationDto;
  myId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [addingMembers, setAddingMembers] = useState(false);
  const [transferTarget, setTransferTarget] = useState<{ id: string; name: string } | null>(null);

  const updatePhoto = useUpdateGroupPhoto(conversation.id);
  const transferAdmin = useTransferAdmin(conversation.id);
  const leave = useLeaveConversation();

  const myRole = conversation.members.find((m) => m.user.id === myId)?.role;
  const canManage = myRole === 'admin';
  const canEditPhoto = canManage || conversation.createdById === myId;

  function onError(error: unknown) {
    toast(error instanceof ApiError ? error.message : 'Something went wrong', { kind: 'error' });
  }

  async function onPhotoPicked(file: File): Promise<void> {
    setUploadingPhoto(true);
    try {
      const url = await uploadGroupPhoto(conversation.id, file);
      await updatePhoto.mutateAsync({ photoUrl: url });
      toast('Group photo updated', { kind: 'success' });
    } catch (error) {
      onError(error);
    } finally {
      setUploadingPhoto(false);
    }
  }

  function removeMember(userId: string): void {
    leave.mutate({ conversationId: conversation.id, userId }, { onError });
  }

  async function confirmTransfer(): Promise<void> {
    if (!transferTarget) return;
    try {
      await transferAdmin.mutateAsync({ toUserId: transferTarget.id });
      toast(`${transferTarget.name} is now the admin`, { kind: 'success' });
      setTransferTarget(null);
    } catch (error) {
      onError(error);
    }
  }

  function leaveGroup(): void {
    leave.mutate(
      { conversationId: conversation.id, userId: myId },
      {
        onSuccess: onClose,
        onError,
      },
    );
  }

  return (
    <Modal open onClose={onClose} title="Group info">
      <div className="flex max-h-[70vh] flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="relative">
            <Avatar name={conversation.name ?? 'Group'} src={conversation.photoUrl} size="xl" />
            {canEditPhoto && (
              <button
                type="button"
                aria-label="Change group photo"
                title="Change group photo"
                disabled={uploadingPhoto}
                onClick={() => fileRef.current?.click()}
                className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full bg-accent text-xs text-white shadow disabled:opacity-60"
              >
                {uploadingPhoto ? '…' : '📷'}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onPhotoPicked(file);
                e.target.value = '';
              }}
            />
          </div>
          <p className="text-base font-semibold text-fg">{conversation.name}</p>
          <p className="text-xs text-fg-muted">{conversation.members.length} members</p>
        </div>

        {canManage && (
          <Button variant="secondary" size="sm" onClick={() => setAddingMembers(true)}>
            Add members
          </Button>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border">
          {conversation.members.map((member) => {
            const isSelf = member.user.id === myId;
            return (
              <div
                key={member.user.id}
                className="flex items-center gap-3 px-3 py-2 hover:bg-surface-sunken"
              >
                <Avatar
                  name={member.user.displayName}
                  src={member.user.avatarUrl}
                  size="sm"
                  online={member.online}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    {isSelf ? `${member.user.displayName} (you)` : member.user.displayName}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    @{member.user.username}
                  </span>
                </span>
                {member.role === 'admin' && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong">
                    Admin
                  </span>
                )}
                {canManage && !isSelf && (
                  <div className="flex shrink-0 items-center gap-1">
                    {member.role !== 'admin' && (
                      <button
                        type="button"
                        onClick={() =>
                          setTransferTarget({ id: member.user.id, name: member.user.displayName })
                        }
                        className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-raised hover:text-fg"
                      >
                        Make admin
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`Remove ${member.user.displayName}`}
                      onClick={() => removeMember(member.user.id)}
                      className="rounded-lg px-2 py-1 text-xs text-danger hover:bg-surface-raised"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <Button variant="danger" size="sm" loading={leave.isPending} onClick={leaveGroup}>
          Leave group
        </Button>
      </div>

      {addingMembers && (
        <AddMembersPanel
          conversation={conversation}
          myId={myId}
          onClose={() => setAddingMembers(false)}
        />
      )}

      {transferTarget && (
        <Modal open onClose={() => setTransferTarget(null)} title="Transfer admin role?">
          <p className="text-sm text-fg-muted">
            {transferTarget.name} will become the group admin and can add/remove members and delete
            any message. You'll become a regular member.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTransferTarget(null)}>
              Cancel
            </Button>
            <Button loading={transferAdmin.isPending} onClick={() => void confirmTransfer()}>
              Transfer
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Admin-only: pick friends not already in the group and wrap the content key for each. */
function AddMembersPanel({
  conversation,
  myId,
  onClose,
}: {
  conversation: ConversationDto;
  myId: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const friendsQuery = useFriends();
  const addMember = useAddMember(conversation.id);
  const [busyId, setBusyId] = useState<string | null>(null);

  const memberIds = new Set(conversation.members.map((m) => m.user.id));
  const friends = (friendsQuery.data?.pages.flatMap((page) => page.items) ?? []).filter(
    (friend) => !memberIds.has(friend.user.id),
  );
  const full = conversation.members.length >= LIMITS.GROUP_MEMBERS_MAX;

  async function addFriend(friend: FriendDto): Promise<void> {
    if (!friend.publicKey) {
      toast(`${friend.user.displayName} has no encryption keys yet`, { kind: 'error' });
      return;
    }
    setBusyId(friend.user.id);
    try {
      const key = await getConversationKey(myId, conversation);
      if (!key) throw new Error('This conversation cannot be decrypted on this device');
      const wrappedKey = await wrapKeyFor(friend.publicKey, key);
      await addMember.mutateAsync({ userId: friend.user.id, wrappedKey });
      toast(`${friend.user.displayName} added`, { kind: 'success' });
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'Could not add that friend', {
        kind: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add members">
      <div className="flex max-h-[60vh] flex-col gap-2">
        {full && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            This group is full ({LIMITS.GROUP_MEMBERS_MAX} members).
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {friendsQuery.isLoading && (
            <div aria-hidden>
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}
          {!friendsQuery.isLoading && friends.length === 0 && (
            <EmptyState
              icon="🤝"
              title="No friends to add"
              description="Everyone's already here."
            />
          )}
          {friends.map((friend) => (
            <div
              key={friend.user.id}
              className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-surface-sunken"
            >
              <Avatar name={friend.user.displayName} src={friend.user.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">
                {friend.user.displayName}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={full || busyId !== null}
                loading={busyId === friend.user.id}
                onClick={() => void addFriend(friend)}
              >
                Add
              </Button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={onClose} className="self-end">
          Done
        </Button>
      </div>
    </Modal>
  );
}
