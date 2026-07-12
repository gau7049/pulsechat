import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '../../components/ui/avatar';
import { EmptyState } from '../../components/ui/empty-state';
import { useAuth } from '../auth/auth-context';
import { useConversations } from '../chat/use-chat';
import { conversationTitle, otherMember } from '../chat/conversation-utils';
import { StatusRail } from '../status/status-rail';
import { useActiveCount } from '../status/use-active-count';

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
  const conversations = useConversations();
  const [scope, setScope] = useState<'all' | 'friends'>('all');
  const activeCount = useActiveCount(scope);

  if (!user) return null;
  const recentChats = (conversations.data?.items ?? []).slice(0, 5);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <Avatar name={user.displayName} src={user.avatarUrl} size="lg" />
          <div>
            <h1 className="text-xl font-bold text-fg">Hey, {user.displayName} 👋</h1>
            <p className="text-sm text-fg-muted">@{user.username}</p>
          </div>
        </div>
        {/* §12.2 active-users indicator, scoped by the everyone/friends toggle. */}
        <button
          type="button"
          onClick={() => setScope((s) => (s === 'all' ? 'friends' : 'all'))}
          className="rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
        >
          🟢 {activeCount.data?.count ?? 0} {scope === 'friends' ? 'friends ' : ''}active right now
        </button>
      </header>

      {/* §12.1 status/live rail. */}
      <StatusRail />

      <section className="rounded-2xl border border-border bg-surface-raised">
        {recentChats.length === 0 ? (
          <EmptyState
            icon="💬"
            title="No conversations yet"
            description="Start a chat from a friend's profile, or head to the Chats tab."
            action={
              <Link
                to="/chats"
                className="inline-flex h-10 items-center rounded-xl bg-accent px-4 text-sm font-medium text-on-accent transition-all hover:bg-accent-strong"
              >
                Go to chats
              </Link>
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {recentChats.map((conversation) => {
              const other = otherMember(conversation, user.id);
              return (
                <Link
                  key={conversation.id}
                  to={`/chats/${conversation.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-sunken"
                >
                  <Avatar
                    name={conversationTitle(conversation, user.id)}
                    src={conversation.type === 'direct' ? (other?.user.avatarUrl ?? null) : null}
                    size="sm"
                    online={conversation.type === 'direct' ? other?.online : undefined}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {conversationTitle(conversation, user.id)}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">
                      {conversation.unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
            <Link
              to="/chats"
              className="block px-4 py-3 text-center text-sm font-medium text-accent hover:text-accent-strong"
            >
              View all chats →
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

export function HomePage() {
  const { user } = useAuth();
  return user ? <SignedInHome /> : <GuestLanding />;
}
