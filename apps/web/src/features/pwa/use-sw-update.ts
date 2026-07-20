import { useEffect } from 'react';
import { useToast } from '../../components/ui/toast';

/**
 * sw.js calls self.skipWaiting()/clients.claim() unconditionally, so a
 * fresh deploy's service worker takes over immediately in the background —
 * no "waiting" worker for us to prompt about. What it does NOT do is hot-swap
 * the JS already loaded into memory for an open tab/installed app, so a
 * session left running across a deploy would silently keep executing old
 * code until the user happens to reload. `controllerchange` fires exactly
 * when a new worker takes control; if this page already had a controller
 * before that (i.e. this isn't the very first install), it means a real
 * update just landed underneath the running app.
 */
export function useServiceWorkerUpdate(): void {
  const { toast } = useToast();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const hadController = Boolean(navigator.serviceWorker.controller);

    const onControllerChange = () => {
      if (!hadController) return;
      toast('A new version of PulseChat is available.', {
        kind: 'info',
        actionLabel: 'Refresh',
        onAction: () => window.location.reload(),
        durationMs: null,
      });
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, [toast]);
}

/** Mount once near the app root, inside ToastProvider. */
export function ServiceWorkerUpdateWatcher(): null {
  useServiceWorkerUpdate();
  return null;
}
