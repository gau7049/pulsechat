import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { InviteLookupDto } from '@pulsechat/shared';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { Skeleton } from '../../components/ui/skeleton';
import { ApiError, get } from '../../lib/api';
import { AuthCard } from '../auth/auth-card';
import { useAuth } from '../auth/auth-context';

/**
 * Invite landing (§10.3): resolves who invited the visitor and funnels them
 * into registration carrying the invite code. Works signed in or out.
 */
export function InviteLandingPage() {
  const { code = '' } = useParams();
  const { user } = useAuth();
  const [inviter, setInviter] = useState<InviteLookupDto['inviter'] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    get<InviteLookupDto>(`/invites/${encodeURIComponent(code)}`)
      .then((data) => {
        if (cancelled) return;
        setInviter(data.inviter);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState(error instanceof ApiError && error.status === 404 ? 'invalid' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (state === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4" aria-busy>
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-border bg-surface-raised p-8">
          <Skeleton className="mx-auto size-14 rounded-full" />
          <Skeleton className="mx-auto h-5 w-2/3" />
          <Skeleton className="mx-auto h-3 w-1/2" />
        </div>
      </main>
    );
  }

  if (state !== 'ready' || !inviter) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <EmptyState
          icon={state === 'invalid' ? '🔗' : '⚠️'}
          title={state === 'invalid' ? 'This invite link is not valid' : 'Something went wrong'}
          description={
            state === 'invalid'
              ? 'It may have been mistyped. You can still join PulseChat directly.'
              : 'Check your connection and try again.'
          }
          action={
            <Button onClick={() => (window.location.href = '/register')}>Create an account</Button>
          }
        />
      </main>
    );
  }

  return (
    <AuthCard
      title="You're invited to PulseChat"
      subtitle="Chat privately, share your day, go live."
      footer={
        user ? undefined : (
          <>
            Already have an account?{' '}
            <Link to="/login" className="font-medium text-accent hover:text-accent-strong">
              Sign in
            </Link>
          </>
        )
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <Avatar name={inviter.displayName} src={inviter.avatarUrl} size="lg" />
        <p className="text-sm text-fg">
          <span className="font-semibold">{inviter.displayName}</span>{' '}
          <span className="text-fg-muted">(@{inviter.username})</span> invited you to join.
        </p>
        {user ? (
          <div className="flex w-full flex-col gap-2">
            <p className="text-sm text-fg-muted">
              You already have an account — visit their profile instead.
            </p>
            <Button onClick={() => (window.location.href = `/u/${inviter.username}`)}>
              View @{inviter.username}
            </Button>
          </div>
        ) : (
          <Link to={`/register?invite=${encodeURIComponent(code)}`} className="w-full">
            <Button size="lg" className="w-full">
              Join and connect
            </Button>
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
