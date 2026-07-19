/**
 * Post content protection (review feedback): a real browser cannot detect or
 * block OS-level screenshots, screen recording, or screen sharing — there is
 * no web API for it on any platform, and DRM (EME/Widevine) only applies to
 * encrypted video streams, not photos. What's actually achievable is
 * deterrence: a forensic watermark baked into the served image (so a leaked
 * screenshot still traces back to the viewer) plus friction on the easy
 * save-image paths (right-click, drag). None of this is a security boundary
 * — it never applies to a post whose author+audience are already fully
 * public (`post.isPublic`), since those are the ones we explicitly want to
 * be downloadable and freely shared (see `downloadImage` below).
 */

/**
 * Inserts a Cloudinary text-overlay transformation into an existing
 * `.../upload/...` URL so the watermark is baked into the pixels Cloudinary
 * serves — unlike a CSS overlay, this survives "Save image as", devtools
 * network inspection, and screenshots alike.
 */
export function watermarkedImageUrl(url: string, label: string): string {
  const marker = '/upload/';
  const index = url.indexOf(marker);
  if (index === -1) return url;
  const text = encodeURIComponent(label);
  const transform = `l_text:Arial_16_bold:${text},co_rgb:FFFFFF,b_rgb:00000066,g_south_east,x_14,y_14,o_70`;
  return `${url.slice(0, index + marker.length)}${transform}/${url.slice(index + marker.length)}`;
}

/** `@username · 16 Jul` — identifies who viewed it without a full timestamp. */
export function watermarkLabel(username: string): string {
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `@${username} · ${date}`;
}

/**
 * Forces an actual file download rather than a navigation — a plain
 * `<a download>` doesn't reliably force cross-origin downloads, so this
 * fetches the bytes and downloads the resulting blob instead.
 */
export async function downloadImage(url: string, filename: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not download this image');
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
