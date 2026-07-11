import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Input } from '../../components/ui/input';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useAuth } from '../auth/auth-context';
import { useKeyStatus } from './chat-keys';
import { ChatWindow } from './chat-window';
import { ConversationList } from './conversation-list';
import { NewChatModal } from './new-chat-modal';
import { useConversations } from './use-chat';

/**
 * Chats hub (§14.1): conversation list + active window, two-pane from md up,
 * stacked on mobile. Also owns the encryption-key device states (§6).
 */
export function ChatsPage() {
  const { user } = useAuth();
  const { id: activeId } = useParams();
  const conversationsQuery = useConversations();
  const { status: keyStatus, unlock } = useKeyStatus(user?.id);
  const [showNewChat, setShowNewChat] = useState(false);

  if (!user) return null;
  const conversations = conversationsQuery.data?.items ?? [];
  const active = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <main className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-6xl">
      <aside
        className={`w-full flex-col border-r border-border md:flex md:w-80 lg:w-96 ${
          activeId ? 'hidden' : 'flex'
        }`}
        aria-label="Chat list"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h1 className="text-xl font-bold text-fg">Chats</h1>
          <Button size="sm" onClick={() => setShowNewChat(true)} disabled={keyStatus !== 'ready'}>
            New chat
          </Button>
        </div>

        {keyStatus === 'locked' && <UnlockPanel unlock={unlock} />}
        {keyStatus === 'missing' && (
          <p className="mx-4 mb-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger">
            This device has no encryption keys for your account, so existing conversations can't be
            decrypted here. Sign in on the browser where you registered. (Key portability is a known
            limitation of the end-to-end design.)
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {conversationsQuery.isLoading && (
            <div aria-hidden>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          )}
          {conversationsQuery.isError && (
            <EmptyState
              icon="⚠️"
              title="Could not load chats"
              action={
                <Button variant="secondary" onClick={() => void conversationsQuery.refetch()}>
                  Retry
                </Button>
              }
            />
          )}
          {!conversationsQuery.isLoading &&
            !conversationsQuery.isError &&
            conversations.length === 0 && (
              <EmptyState
                icon="💬"
                title="No conversations yet"
                description="Start a chat with a friend — messages are encrypted end to end."
                action={
                  <Button onClick={() => setShowNewChat(true)} disabled={keyStatus !== 'ready'}>
                    New chat
                  </Button>
                }
              />
            )}
          <ConversationList conversations={conversations} />
        </div>
      </aside>

      <div className={`min-w-0 flex-1 ${activeId ? 'block' : 'hidden md:block'}`}>
        {active ? (
          <ChatWindow key={active.id} conversation={active} />
        ) : activeId && conversationsQuery.isLoading ? (
          <div className="p-6" aria-hidden>
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : activeId ? (
          <EmptyState icon="🕳️" title="Conversation not found" />
        ) : (
          <EmptyState
            icon="🔐"
            title="Pick a conversation"
            description="Your messages stay encrypted — only members can read them."
          />
        )}
      </div>

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
    </main>
  );
}

/** Password prompt for devices holding a wrapped key without a live session key. */
function UnlockPanel({ unlock }: { unlock: (password: string) => Promise<boolean> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await unlock(password);
    setBusy(false);
    if (!ok) setError('Wrong password — keys stay locked');
  }

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className="mx-4 mb-2 flex flex-col gap-2 rounded-xl border border-border bg-surface-sunken p-3"
    >
      <p className="text-xs text-fg-muted">
        🔒 Enter your password to unlock your encryption keys on this device.
      </p>
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error ?? undefined}
        required
      />
      <Button type="submit" size="sm" loading={busy} disabled={password.length === 0}>
        Unlock messages
      </Button>
    </form>
  );
}
