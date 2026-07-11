/**
 * Content-shaped loading placeholder (Requirement Scope §20: skeletons, not
 * spinners — first-class). Compose into view-specific skeletons per screen.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`block animate-pulse rounded-lg bg-fg-muted/15 ${className}`} />
  );
}

/** A common row shape: avatar circle + two text lines (chat list, search…). */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3">
      <Skeleton className="size-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}
