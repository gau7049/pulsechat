import { useState, type MouseEventHandler } from 'react';
import { blurredImageUrl } from '../../lib/cloudinary-url';
import { handleImageError } from '../../lib/image-fallback';

export interface BlurUpImageProps {
  src: string;
  alt: string;
  /** Sizing/border-radius classes for the real `<img>` — passed straight through. */
  className?: string;
  onClick?: MouseEventHandler<HTMLImageElement>;
}

/**
 * WhatsApp-style progressive load for images whose final aspect ratio isn't
 * known ahead of time (chat bubbles, story viewer — sized naturally via
 * `object-contain`, unlike `ProgressiveImage`'s fixed-aspect grid tiles). A
 * heavily blurred, tiny Cloudinary-derived variant shows immediately behind
 * the full image, crossfading out once the real one finishes loading — a
 * recognizable photo appears at once instead of a blank/grey box, even on a
 * slow connection. `min-h-32` only matters before the real image has a
 * measured size; it settles to the actual size once loaded.
 */
export function BlurUpImage({ src, alt, className, onClick }: BlurUpImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <span className="relative block min-h-32 overflow-hidden">
      {!loaded && (
        <img
          aria-hidden
          src={blurredImageUrl(src)}
          alt=""
          className="absolute inset-0 size-full scale-110 object-cover blur-lg"
        />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onClick={onClick}
        onLoad={() => setLoaded(true)}
        onError={(e) => {
          setLoaded(true);
          handleImageError(e);
        }}
        className={`relative transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${className ?? ''}`}
      />
    </span>
  );
}
