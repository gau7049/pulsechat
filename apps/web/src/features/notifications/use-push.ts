import { useCallback, useEffect, useState } from 'react';
import { usePushSubscription } from './use-notifications';

const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY || undefined;

/** Push is only possible when the browser supports it and the manual VAPID
 * setup step (ROADMAP "Pending manual setup") has landed. */
export const pushSupported =
  VAPID_PUBLIC_KEY !== undefined && 'serviceWorker' in navigator && 'PushManager' in window;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Settings → Notifications toggle: subscribes/unsubscribes this device. */
export function usePush() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const { subscribe, unsubscribe } = usePushSubscription();

  useEffect(() => {
    if (!pushSupported) return;
    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(sub !== null));
  }, []);

  const enable = useCallback(async () => {
    if (!pushSupported || !VAPID_PUBLIC_KEY) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
      await subscribe.mutateAsync(sub.toJSON() as PushSubscriptionJSON);
      setEnabled(true);
    } finally {
      setBusy(false);
    }
  }, [subscribe]);

  const disable = useCallback(async () => {
    if (!pushSupported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribe.mutateAsync(sub.endpoint);
        await sub.unsubscribe();
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }, [unsubscribe]);

  return { supported: pushSupported, enabled, busy, enable, disable };
}
