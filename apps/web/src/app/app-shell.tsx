import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/ui/avatar';
import { useAuth } from '../features/auth/auth-context';
import { OnboardingTour } from '../features/onboarding/onboarding-tour';

/** Signed-in application chrome: top bar + content outlet. */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return <Outlet />;

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-surface-raised/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex items-center gap-2" aria-label="PulseChat home">
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-xl bg-accent text-sm font-bold text-on-accent"
            >
              P
            </span>
            <span className="hidden text-lg font-bold text-fg sm:block">PulseChat</span>
          </Link>

          <nav aria-label="Primary" className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent-strong' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              Home
            </NavLink>
            <NavLink
              to="/people"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent-strong' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              People
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent-strong' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              Settings
            </NavLink>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login'));
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Log out
            </button>
          </nav>

          <Link to="/settings" aria-label="Your profile settings">
            <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
          </Link>
        </div>
      </header>

      <div className="flex-1">
        <Outlet />
      </div>

      {!user.onboardedAt && <OnboardingTour />}
    </div>
  );
}
