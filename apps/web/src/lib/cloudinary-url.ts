/**
 * Inserts a Cloudinary transformation into an existing `.../upload/...`
 * delivery URL. Every attachment/post/status URL in this app is a plain,
 * untransformed `secure_url` straight from Cloudinary's upload response
 * (confirmed: nothing mutates it before storage), so this splice is safe —
 * same technique `features/posts/post-protection.ts`'s `watermarkedImageUrl`
 * already uses in production. Falls back to the original URL unchanged for
 * anything that isn't a Cloudinary URL (e.g. local/test fixtures).
 */
function insertTransform(url: string, transform: string): string {
  const marker = '/upload/';
  const index = url.indexOf(marker);
  if (index === -1) return url;
  return `${url.slice(0, index + marker.length)}${transform}/${url.slice(index + marker.length)}`;
}

/**
 * A heavily blurred, tiny (~a few KB) variant of an image — shown behind the
 * full-resolution one while it loads (WhatsApp-style blur-up), so a slow
 * connection reveals something recognizable immediately instead of a blank
 * box. `w_40` keeps bytes minimal; Cloudinary derives height automatically,
 * preserving the original aspect ratio.
 */
export function blurredImageUrl(url: string): string {
  return insertTransform(url, 'e_blur:1500,w_40,q_1');
}
