import { useState, type MouseEvent } from 'react';
import { handleImageError } from '../../lib/image-fallback';

export interface ProgressiveImageProps {
  src: string;
  alt: string;
  /** Fixes the box's height before the image loads — stops it "growing" into view. */
  aspectClassName?: string;
  className?: string;
  /** Extra classes on the <img> itself, e.g. a hover zoom transform. */
  imgClassName?: string;
  /**
   * Adds friction to the easy save-image paths (right-click, drag) and opts
   * the image out of print — a deterrent only, never a security boundary.
   * See `features/posts/post-protection.ts` for the full rationale.
   */
  protectedContent?: boolean;
}

/**
 * A fixed-aspect-ratio image box with a skeleton shown until the image has
 * fully decoded — without a stable box, a large photo streaming in over a
 * slow connection visibly grows/paints top-to-bottom instead of just
 * appearing once ready.
 */
export function ProgressiveImage({
  src,
  alt,
  aspectClassName = 'aspect-square',
  className = '',
  imgClassName = '',
  protectedContent = false,
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div
      className={`relative w-full overflow-hidden bg-surface-sunken ${aspectClassName} ${className}`}
    >
      {!loaded && <div aria-hidden className="absolute inset-0 animate-pulse bg-surface-sunken" />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setLoaded(true);
          handleImageError(e);
        }}
        {...(protectedContent
          ? {
              onContextMenu: (e: MouseEvent) => e.preventDefault(),
              draggable: false,
              'data-protected': 'true',
            }
          : {})}
        className={`size-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${imgClassName}`}
      />
    </div>
  );
}
