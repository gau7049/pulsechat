import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import { usePwaInstall } from './use-pwa-install';

/** §24.9 — the actual visible "install as app" control, in Settings → Appearance. */
export function InstallAppCard() {
  const { installed, canInstall, isIos, promptInstall } = usePwaInstall();
  const { toast } = useToast();

  if (installed) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">Install app</h3>
        <p className="text-sm text-fg-muted">✅ You're using the installed app.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-fg">Install app</h3>
      {canInstall && (
        <>
          <p className="mb-2 text-sm text-fg-muted">
            Install PulseChat for a full-screen, app-like experience with its own home-screen icon.
          </p>
          <Button
            size="sm"
            onClick={() => {
              void promptInstall().then((accepted) => {
                if (!accepted) toast('Install dismissed — you can try again anytime here');
              });
            }}
          >
            📲 Install PulseChat
          </Button>
        </>
      )}
      {!canInstall && isIos && (
        <p className="text-sm text-fg-muted">
          Tap the Share icon <span aria-hidden>⎋</span> in Safari's toolbar, then choose{' '}
          <strong>Add to Home Screen</strong>.
        </p>
      )}
      {!canInstall && !isIos && (
        <p className="text-sm text-fg-muted">
          Your browser hasn't offered an install prompt yet — look for an install icon in the
          address bar, or check the browser menu for "Install app" / "Add to Home screen".
        </p>
      )}
    </div>
  );
}
