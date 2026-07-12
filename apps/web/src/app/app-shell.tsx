import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/ui/avatar';
import { CallOverlay } from '../features/calls/call-overlay';
import { useCallSocketBridge } from '../features/calls/use-calls';
import { useAuth } from '../features/auth/auth-context';
import { useChatSocketBridge, useConversations } from '../features/chat/use-chat';
import { OnboardingTour } from '../features/onboarding/onboarding-tour';
import { PostComposer } from '../features/posts/post-composer';
import { useStatusSocketBridge } from '../features/status/use-status';

/** Signed-in application chrome: top bar + content outlet. */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);
  // One socket-event bridge per signed-in session keeps every cache live.
  useChatSocketBridge(user?.id);
  useStatusSocketBridge(user?.id);
  // Mounted here (not per-route) so an incoming call rings on any screen.
  useCallSocketBridge(user?.id);

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
            <ChatsNavLink />
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
              to="/explore"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-accent-soft text-accent-strong' : 'text-fg-muted hover:text-fg'
                }`
              }
            >
              Explore
            </NavLink>
            {/* §13.1 "prominent center control" for creating a post. */}
            <button
              type="button"
              title="Create post"
              aria-label="Create post"
              onClick={() => setComposing(true)}
              className="mx-1 flex size-8 shrink-0 items-center justify-center self-center rounded-full bg-accent text-lg leading-none font-bold text-on-accent transition-colors hover:bg-accent-strong"
            >
              +
            </button>
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

          <Link to="/settings" aria-label="Your profile settings" title="Your profile settings">
            <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
          </Link>
        </div>
      </header>

      <div className="flex-1">
        <Outlet />
      </div>

      {!user.onboardedAt && <OnboardingTour />}
      <CallOverlay />
      {composing && <PostComposer onClose={() => setComposing(false)} />}
    </div>
  );
}

/** Chats nav item with the total-unread badge (§14.1), fed by the live cache. */
function ChatsNavLink() {
  const conversations = useConversations();
  // Muted conversations (§14.11) don't demand attention in the nav badge.
  const unread =
    conversations.data?.items.reduce((sum, c) => sum + (c.muted ? 0 : c.unreadCount), 0) ?? 0;
  return (
    <NavLink
      to="/chats"
      className={({ isActive }) =>
        `relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive ? 'bg-accent-soft text-accent-strong' : 'text-fg-muted hover:text-fg'
        }`
      }
    >
      Chats
      {unread > 0 && (
        <span
          aria-label={`${unread} unread messages`}
          className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-on-accent"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  );
}
