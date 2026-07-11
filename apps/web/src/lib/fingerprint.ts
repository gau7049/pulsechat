/**
 * Stable per-browser device identifier for the §6.6 new-device check.
 * Random on first visit, persisted for the browser's lifetime.
 */
const KEY = 'pulsechat.device';

export function getDeviceFingerprint(): string {
  let value = localStorage.getItem(KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(KEY, value);
  }
  return value;
}
