import { Link } from 'react-router-dom';
import { Avatar } from '../../components/ui/avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { useAuth } from '../auth/auth-context';

function GuestLanding() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface px-4 text-center">
      <span
        aria-hidden
        className="flex size-16 items-center justify-center rounded-3xl bg-accent text-3xl font-bold text-on-accent"
      >
        P
      </span>
      <div>
        <h1 className="text-3xl font-black text-fg">PulseChat</h1>
        <p className="mt-2 max-w-md text-fg-muted">
          Real-time chat with friends, 24-hour statuses, live moments, and a feed that's yours —
          private by design, encrypted at rest.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          to="/register"
          className="inline-flex h-11 items-center rounded-xl bg-accent px-6 text-sm font-semibold text-on-accent transition-all hover:bg-accent-strong"
        >
          Create account
        </Link>
        <Link
          to="/login"
          className="inline-flex h-11 items-center rounded-xl border border-border bg-surface-raised px-6 text-sm font-semibold text-fg transition-colors hover:bg-surface-sunken"
        >
          Sign in
        </Link>
      </div>
    </main>
  );
}

function SignedInHome() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center gap-4">
        <Avatar name={user.displayName} src={user.avatarUrl} size="lg" />
        <div>
          <h1 className="text-xl font-bold text-fg">Hey, {user.displayName} 👋</h1>
          <p className="text-sm text-fg-muted">@{user.username}</p>
        </div>
      </header>

      {/* The status/live rail (M5) and chat list (M3) mount here. */}
      <section className="rounded-2xl border border-border bg-surface-raised">
        <EmptyState
          icon="🫂"
          title="Your people will appear here"
          description="Friend search and requests arrive in the next milestone (M2). Chats, statuses, and the feed follow right after."
          action={
            <Link
              to="/settings/profile"
              className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-all hover:bg-accent-strong"
            >
              Polish your profile meanwhile
            </Link>
          }
        />
      </section>
    </main>
  );
}

export function HomePage() {
  const { user } = useAuth();
  return user ? <SignedInHome /> : <GuestLanding />;
}
