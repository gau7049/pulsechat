import { Link } from 'react-router-dom';

/** Custom-styled 404 (Requirement Scope §20), consistent with the app design. */
export function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <p className="text-6xl font-black text-accent" aria-hidden>
        404
      </p>
      <h1 className="text-2xl font-bold text-fg">This page drifted away</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        The link may be broken, or the page may have been moved or deleted.
      </p>
      <Link
        to="/"
        className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-all hover:bg-accent-strong"
      >
        Back to PulseChat
      </Link>
    </main>
  );
}
