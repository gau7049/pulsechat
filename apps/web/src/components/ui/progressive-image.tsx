import { useState } from 'react';

export interface ProgressiveImageProps {
  src: string;
  alt: string;
  /** Fixes the box's height before the image loads — stops it "growing" into view. */
  aspectClassName?: string;
  className?: string;
  /** Extra classes on the <img> itself, e.g. a hover zoom transform. */
  imgClassName?: string;
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
        className={`size-full object-cover transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        } ${imgClassName}`}
      />
    </div>
  );
}
