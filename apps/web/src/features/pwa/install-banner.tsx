import { useState } from 'react';
import { usePwaInstall } from './use-pwa-install';

const DISMISSED_KEY = 'pulsechat:install-banner-dismissed';

/**
 * §24.9 — a higher-visibility nudge than the Settings card, for the same
 * "users never notice the address-bar icon" reason. Dismissible and
 * remembered per browser; never shown again once the app is installed.
 */
export function InstallBanner() {
  const { installed, canInstall, isIos, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED_KEY) === 'true');

  function dismiss(): void {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  }

  if (installed || dismissed || (!canInstall && !isIos)) return null;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft/50 px-4 py-3">
      <span aria-hidden className="text-xl">
        📲
      </span>
      <p className="min-w-0 flex-1 text-sm text-fg">
        {canInstall
          ? 'Install PulseChat for a full-screen, app-like experience.'
          : 'Add PulseChat to your Home Screen: tap Share, then "Add to Home Screen".'}
      </p>
      {canInstall && (
        <button
          type="button"
          onClick={() => void promptInstall().then(() => dismiss())}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-on-accent hover:bg-accent-strong"
        >
          Install
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={dismiss}
        className="shrink-0 rounded-lg px-2 py-1.5 text-fg-muted hover:text-fg"
      >
        ✕
      </button>
    </div>
  );
}
