import type { SyntheticEvent } from 'react';

/**
 * Inline placeholder (no network round-trip, so it can never itself fail to
 * load) shown when a remote image URL 404s, times out, or is otherwise
 * unreachable — avoids the browser's broken-image icon.
 */
const FALLBACK_IMAGE_SRC =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<rect width="100" height="100" fill="#232838"/>' +
      '<path d="M22 68 L40 44 L54 60 L70 38 L86 68 Z" fill="#3a4258"/>' +
      '<circle cx="35" cy="32" r="8" fill="#3a4258"/>' +
      '</svg>',
  );

/**
 * Drop-in `onError` handler for `<img>` tags. Swaps to a local placeholder
 * once, guarded by a data attribute so a failing placeholder can't loop.
 */
export function handleImageError(event: SyntheticEvent<HTMLImageElement>): void {
  const img = event.currentTarget;
  if (img.dataset.fallback) return;
  img.dataset.fallback = 'true';
  img.src = FALLBACK_IMAGE_SRC;
}
