import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { setSoundEnabled, useSoundEnabled } from '../../lib/sound';
import { usePush } from '../notifications/use-push';

/** Settings → Notifications (Requirement Scope §17, Technical Spec §12). */
export function NotificationsSection() {
  const { toast } = useToast();
  const push = usePush();
  const soundEnabled = useSoundEnabled();

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="notif-push">
        <h3 id="notif-push" className="mb-1 text-sm font-semibold text-fg">
          Push notifications
        </h3>
        {push.supported ? (
          <Switch
            label="Browser notifications on this device"
            description="Friend requests, likes, comments, moderation notices, and new messages while you're away"
            checked={push.enabled}
            disabled={push.busy}
            busy={push.busy}
            onChange={(value) => {
              void (value ? push.enable() : push.disable()).catch((err) =>
                toast(err instanceof Error ? err.message : 'Could not update push notifications', {
                  kind: 'error',
                }),
              );
            }}
          />
        ) : (
          <p className="text-sm text-fg-muted">
            Push notifications aren't available — either this browser doesn't support them, or the
            server hasn't been configured with a VAPID key yet.
          </p>
        )}
      </section>
      <section aria-labelledby="notif-sound">
        <h3 id="notif-sound" className="mb-1 text-sm font-semibold text-fg">
          Sound
        </h3>
        <Switch
          label="Message sounds"
          description="A short sound when you send or receive a chat message"
          checked={soundEnabled}
          onChange={setSoundEnabled}
        />
      </section>
    </div>
  );
}
