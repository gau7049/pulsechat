import { useEffect, useState } from 'react';

/**
 * §24.9 installable PWA. The manifest + service worker (already shipped)
 * only make the browser *capable* of installing — Chrome/Edge/Android still
 * hide the actual trigger behind an address-bar icon or a browser menu entry
 * most users never notice. This captures `beforeinstallprompt` so the app
 * can offer its own visible "Install" button instead.
 *
 * iOS Safari never fires `beforeinstallprompt` (no programmatic install API
 * exists there) — callers fall back to manual "Share → Add to Home Screen"
 * instructions for `isIos`.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandaloneNow(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosDevice(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandaloneNow);

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event): void {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }
    function onInstalled(): void {
      setInstalled(true);
      setDeferredPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<boolean> {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === 'accepted';
  }

  return {
    installed,
    /** True once the browser has offered an installable prompt to capture. */
    canInstall: deferredPrompt !== null,
    /** iOS never exposes a programmatic prompt — show manual instructions instead. */
    isIos: isIosDevice(),
    promptInstall,
  };
}
