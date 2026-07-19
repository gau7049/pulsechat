import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  /** Optional call-to-action, e.g. "Find friends". */
  action?: ReactNode;
}

/**
 * Helpful empty state (Requirement Scope §20) — every data view renders this
 * instead of a blank screen when it has no content.
 */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {icon && (
        <div className="text-4xl" aria-hidden>
          {icon}
        </div>
      )}
      <h2 className="text-lg font-bold text-fg">{title}</h2>
      {description && <p className="max-w-sm text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
