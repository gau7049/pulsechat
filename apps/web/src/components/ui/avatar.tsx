import { useEffect, useState } from 'react';

type Size = 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: Size;
  /** Presence dot (online) — wired to socket presence from M3. */
  online?: boolean;
}

const sizeClasses: Record<Size, string> = {
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-24 text-3xl',
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** User avatar with image fallback to initials, plus optional presence dot. */
export function Avatar({ name, src, size = 'md', online }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  return (
    <span className={`relative inline-flex shrink-0 ${sizeClasses[size]}`}>
      {src && !failed ? (
        <img
          src={src}
          alt={name}
          onError={() => setFailed(true)}
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className="flex size-full items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-strong"
        >
          {initials(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          aria-hidden
          className={`absolute right-0 bottom-0 size-1/4 rounded-full ring-2 ring-surface ${
            online ? 'bg-success' : 'bg-fg-muted/40'
          }`}
        />
      )}
    </span>
  );
}
