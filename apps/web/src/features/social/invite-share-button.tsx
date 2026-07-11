import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { useMyInvite } from './use-social';

/**
 * Invite friends (§10.3): fetches the personal code, then prefers the
 * device's native share sheet and falls back to copying the link.
 */
export function InviteShareButton() {
  const { toast } = useToast();
  const invite = useMyInvite();

  async function share() {
    try {
      const { code } = await invite.mutateAsync();
      const url = `${window.location.origin}/invite/${code}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Join me on PulseChat',
            text: 'Chat privately with me on PulseChat',
            url,
          });
          return;
        } catch (error) {
          // Cancelling the share sheet is not an error; anything else falls
          // through to the clipboard path.
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await navigator.clipboard.writeText(url);
      toast('Invite link copied to clipboard');
    } catch {
      toast('Could not create your invite link — try again', { kind: 'error' });
    }
  }

  return (
    <Button variant="secondary" size="sm" loading={invite.isPending} onClick={() => void share()}>
      Invite friends
    </Button>
  );
}
