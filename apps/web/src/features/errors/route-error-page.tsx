import { Link, useRouteError } from 'react-router-dom';

/**
 * Router-level error element — shown when a route loader/render throws.
 * Friendly copy only; the actual error goes to the console for developers.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  console.error('Route error', error);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
      <p className="text-5xl" aria-hidden>
        🛰️
      </p>
      <h1 className="text-2xl font-bold text-fg">We hit a snag loading this page</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        Try again in a moment — if it keeps happening, the issue is on our side.
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
