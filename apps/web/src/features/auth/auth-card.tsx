import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Shared layout for every auth screen. Desktop (lg+) renders the wireframe
 * split panel (frames L1/L2): dark brand pane left, form right. Mobile keeps
 * the single-column layout of frames A1–A4.
 */
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
    <main className="flex min-h-dvh bg-surface">
      {/* Brand pane (frame L1): logo mark, tagline, privacy-first subline. */}
      <section className="brand-gradient hidden w-[42%] shrink-0 flex-col justify-center p-14 text-white lg:flex">
        <span aria-hidden className="logo-gradient mb-6 block size-13 rounded-2xl" />
        <h2 className="mb-3 text-[32px] leading-tight font-extrabold">Chat with real presence.</h2>
        <p className="max-w-sm text-sm leading-relaxed text-white/75">
          Friends-first messaging, status, live streams, and a feed — private by design.
        </p>
      </section>

      <div className="flex min-w-0 flex-1 flex-col items-center justify-center px-6 py-10">
        <Link to="/" className="mb-6 flex items-center gap-2 lg:hidden" aria-label="PulseChat home">
          <span aria-hidden className="logo-gradient block size-11 rounded-2xl" />
          <span className="text-xl font-extrabold tracking-tight text-fg">PulseChat</span>
        </Link>
        <section className="w-full max-w-sm">
          <h1 className="text-2xl font-extrabold text-fg">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm font-medium text-fg-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && (
            <div className="mt-5 text-center text-sm font-medium text-fg-muted">{footer}</div>
          )}
        </section>
      </div>
    </main>
  );
}
