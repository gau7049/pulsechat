import type { Relationship } from '@pulsechat/shared';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { ApiError } from '../../lib/api';
import { useRespondToRequest, useSendFriendRequest } from './use-social';

/**
 * The context-aware friend action (§10): add / cancel / accept / friends.
 * Renders nothing for `self` and `blocked` — those are handled where shown.
 */
export function RelationshipButton({
  userId,
  relationship,
  canSendRequest,
  requestId,
}: {
  userId: string;
  relationship: Relationship;
  canSendRequest: boolean;
  requestId: string | null;
}) {
  const { toast } = useToast();
  const send = useSendFriendRequest();
  const respond = useRespondToRequest();

  function onError(error: unknown) {
    toast(error instanceof ApiError ? error.message : 'Something went wrong', { kind: 'error' });
  }

  switch (relationship) {
    case 'none':
      return canSendRequest ? (
        <Button size="sm" loading={send.isPending} onClick={() => send.mutate(userId, { onError })}>
          Add friend
        </Button>
      ) : (
        <span className="text-xs text-fg-muted">Not accepting requests</span>
      );
    case 'outgoing_pending':
      return (
        <Button
          size="sm"
          variant="secondary"
          loading={respond.isPending}
          onClick={() => requestId && respond.mutate({ requestId, action: 'cancel' }, { onError })}
        >
          Cancel request
        </Button>
      );
    case 'incoming_pending':
      return (
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            loading={respond.isPending}
            onClick={() =>
              requestId && respond.mutate({ requestId, action: 'accept' }, { onError })
            }
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={respond.isPending}
            onClick={() =>
              requestId && respond.mutate({ requestId, action: 'reject' }, { onError })
            }
          >
            Reject
          </Button>
        </span>
      );
    case 'friends':
      return <span className="text-xs font-medium text-success">Friends</span>;
    default:
      return null;
  }
}
