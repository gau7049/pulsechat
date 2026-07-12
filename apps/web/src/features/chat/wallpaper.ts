/**
 * Chat wallpaper presets (§14.9): per-conversation, stored locally on the
 * device (wallpaper choice is cosmetic device state, like zoom level).
 */

export interface Wallpaper {
  id: string;
  label: string;
  /** CSS background value layered under the message list. */
  css: string;
}

export const WALLPAPERS: Wallpaper[] = [
  { id: 'default', label: 'Default', css: 'transparent' },
  { id: 'dawn', label: 'Dawn', css: 'linear-gradient(160deg, #fde68a33, #fca5a533)' },
  { id: 'ocean', label: 'Ocean', css: 'linear-gradient(160deg, #7dd3fc33, #6366f133)' },
  { id: 'meadow', label: 'Meadow', css: 'linear-gradient(160deg, #86efac33, #14b8a633)' },
  { id: 'plum', label: 'Plum', css: 'linear-gradient(160deg, #d8b4fe33, #f472b633)' },
  {
    id: 'dots',
    label: 'Dots',
    css: 'radial-gradient(circle, #8884 1px, transparent 1.2px) 0 0 / 18px 18px',
  },
];

const storageKey = (conversationId: string) => `pulsechat:wallpaper:${conversationId}`;

export function getWallpaper(conversationId: string): Wallpaper {
  const id = localStorage.getItem(storageKey(conversationId));
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]!;
}

export function setWallpaper(conversationId: string, id: string): void {
  localStorage.setItem(storageKey(conversationId), id);
}
