import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/ui/avatar';
import { CallOverlay } from '../features/calls/call-overlay';
import { useCallSocketBridge } from '../features/calls/use-calls';
import { useAuth } from '../features/auth/auth-context';
import { StepUpProvider } from '../features/auth/step-up-context';
import { useChatSocketBridge, useConversations } from '../features/chat/use-chat';
import { NotificationBell } from '../features/notifications/notification-bell';
import {
  unreadCountFrom,
  useNotifications,
  useNotificationSocketBridge,
} from '../features/notifications/use-notifications';
import { OnboardingTour } from '../features/onboarding/onboarding-tour';
import { PostComposer } from '../features/posts/post-composer';
import { useStatusSocketBridge } from '../features/status/use-status';

/**
 * Signed-in application chrome, responsive per the wireframes:
 * desktop (lg+) gets the 230px left sidebar (frame B3), mobile gets a slim
 * top bar plus the five-slot bottom tab bar (frame B1).
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [composing, setComposing] = useState(false);
  // One socket-event bridge per signed-in session keeps every cache live.
  useChatSocketBridge(user?.id);
  useStatusSocketBridge(user?.id);
  useNotificationSocketBridge(user?.id);
  // Mounted here (not per-route) so an incoming call rings on any screen.
  useCallSocketBridge(user?.id);

  if (!user) return <Outlet />;

  const profileHref = `/u/${user.username}`;

  return (
    <StepUpProvider>
      <div className="flex min-h-dvh bg-surface">
        {/* ── Desktop sidebar (frame B3) ── */}
        <aside className="sticky top-0 hidden h-dvh w-[230px] shrink-0 flex-col gap-1 border-r border-border bg-surface-raised px-4 py-6 lg:flex">
          <Link
            to="/"
            aria-label="PulseChat home"
            className="mx-2 mb-5 flex items-center gap-2 text-xl font-extrabold tracking-tight text-fg"
          >
            <span
              aria-hidden
              className="flex size-8 items-center justify-center rounded-xl bg-accent text-sm font-bold text-on-accent"
            >
              P
            </span>
            Pulse
          </Link>

          <SideNavLink to="/" end icon="⌂" label="Home" />
          <SideNavLink to="/explore" icon="🧭" label="Explore" />
          <SideNavLink to="/people" icon="🔍" label="Search" />
          <ChatsSideNavLink />
          <NotificationsSideNavLink />
          <SideNavLink to={profileHref} icon="👤" label="Profile" />
          <SideNavLink to="/settings" icon="⚙️" label="Settings" />
          {user.role === 'admin' && <SideNavLink to="/admin" icon="📊" label="Admin" />}

          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="flex h-11 items-center justify-center rounded-[10px] bg-accent text-[13.5px] font-bold text-on-accent transition-colors hover:bg-accent-strong"
            >
              + Create post
            </button>
            <button
              type="button"
              onClick={() => {
                void logout().then(() => navigate('/login'));
              }}
              className="flex h-10 items-center justify-center rounded-[10px] text-[13px] font-semibold text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg"
            >
              Log out
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* ── Mobile top bar (frame B1 header) ── */}
          <header className="sticky top-0 z-40 border-b border-border bg-surface-raised/90 backdrop-blur lg:hidden">
            <div className="flex h-13 items-center justify-between px-5 py-2">
              <Link
                to="/"
                aria-label="PulseChat home"
                className="text-xl font-extrabold tracking-tight text-fg"
              >
                Pulse
              </Link>
              <div className="flex items-center gap-1">
                {user.role === 'admin' && (
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      `rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors ${
                        isActive ? 'text-accent' : 'text-fg-muted hover:text-fg'
                      }`
                    }
                  >
                    Admin
                  </NavLink>
                )}
                <Link
                  to="/people"
                  aria-label="Search people"
                  title="Search people"
                  className="rounded-lg px-2 py-1.5 text-lg leading-none text-fg-muted transition-colors hover:text-fg"
                >
                  🔍
                </Link>
                <NotificationBell />
                <Link
                  to="/settings"
                  aria-label="Settings"
                  title="Settings"
                  className="rounded-lg px-2 py-1.5 text-lg leading-none text-fg-muted transition-colors hover:text-fg"
                >
                  ⚙️
                </Link>
              </div>
            </div>
          </header>

          {/* Bottom padding on mobile keeps content clear of the fixed tab bar. */}
          <div className="flex-1 pb-20 lg:pb-0">
            <Outlet />
          </div>
        </div>

        {/* ── Mobile bottom tab bar (frame B1) ── */}
        <nav
          aria-label="Primary"
          className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-border bg-surface-raised pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <TabNavLink to="/" end icon="⌂" label="Home" />
          <TabNavLink to="/explore" icon="🧭" label="Explore" />
          <button
            type="button"
            title="Create post"
            aria-label="Create post"
            onClick={() => setComposing(true)}
            className="flex h-8 w-11 items-center justify-center rounded-[9px] bg-accent text-xl leading-none font-bold text-on-accent transition-colors hover:bg-accent-strong"
          >
            +
          </button>
          <ChatsTabNavLink />
          <NavLink
            to={profileHref}
            aria-label="Your profile"
            className={({ isActive }) =>
              `flex flex-col items-center rounded-full transition-opacity ${
                isActive ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised' : ''
              }`
            }
          >
            <Avatar name={user.displayName} src={user.avatarUrl} size="sm" />
          </NavLink>
        </nav>

        {!user.onboardedAt && <OnboardingTour />}
        <CallOverlay />
        {composing && <PostComposer onClose={() => setComposing(false)} />}
      </div>
    </StepUpProvider>
  );
}

/** Sidebar item: icon + label, soft-accent active pill (frame B3). */
function SideNavLink({
  to,
  icon,
  label,
  end,
  badge,
}: {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
  badge?: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] transition-colors ${
          isActive
            ? 'bg-accent-soft font-bold text-accent'
            : 'font-semibold text-fg-muted hover:bg-surface-sunken hover:text-fg'
        }`
      }
    >
      <span aria-hidden className="w-5 text-center text-base leading-none">
        {icon}
      </span>
      {label}
      {badge}
    </NavLink>
  );
}

/** Mobile tab item (frame B1 bottom bar). */
function TabNavLink({
  to,
  icon,
  label,
  end,
  badge,
}: {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
  badge?: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `relative flex size-10 items-center justify-center rounded-xl text-xl transition-colors ${
          isActive ? 'text-accent' : 'text-fg-muted hover:text-fg'
        }`
      }
    >
      <span aria-hidden>{icon}</span>
      {badge}
    </NavLink>
  );
}

function UnreadBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-on-accent"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Total unread across conversations; muted chats don't demand attention (§14.11). */
function useUnreadChatCount(): number {
  const conversations = useConversations();
  return conversations.data?.items.reduce((sum, c) => sum + (c.muted ? 0 : c.unreadCount), 0) ?? 0;
}

function ChatsSideNavLink() {
  const unread = useUnreadChatCount();
  return (
    <SideNavLink
      to="/chats"
      icon="💬"
      label="Messages"
      badge={<UnreadBadge count={unread} label={`${unread} unread messages`} />}
    />
  );
}

function ChatsTabNavLink() {
  const unread = useUnreadChatCount();
  return (
    <TabNavLink
      to="/chats"
      icon="💬"
      label="Messages"
      badge={<UnreadBadge count={unread} label={`${unread} unread messages`} />}
    />
  );
}

function NotificationsSideNavLink() {
  const query = useNotifications();
  const unread = unreadCountFrom(query.data?.pages);
  return (
    <SideNavLink
      to="/notifications"
      icon="🔔"
      label="Notifications"
      badge={<UnreadBadge count={unread} label={`${unread} unread notifications`} />}
    />
  );
}
