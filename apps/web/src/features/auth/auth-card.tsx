import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Shared centered card layout for every auth screen. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-surface px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2" aria-label="PulseChat home">
        <span
          aria-hidden
          className="flex size-10 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-on-accent"
        >
          P
        </span>
        <span className="text-xl font-bold text-fg">PulseChat</span>
      </Link>
      <section className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-6 shadow-sm">
        <h1 className="text-xl font-bold text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </section>
      {footer && <div className="mt-4 text-sm text-fg-muted">{footer}</div>}
    </main>
  );
}
