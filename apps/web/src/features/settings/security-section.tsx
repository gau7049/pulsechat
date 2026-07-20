import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditLogEntryDto, DeviceDto, MeDto } from '@pulsechat/shared';
import { ApiError, del, get, patch, post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SkeletonRow } from '../../components/ui/skeleton';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';
import { PasswordStrengthMeter } from '../auth/password-strength-meter';
import { runWithStepUp, useStepUp } from '../auth/step-up-context';

function ChangePasswordForm() {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await patch('/account/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      toast('Password changed. Other devices were signed out.', { kind: 'success' });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (Object.values(err.details ?? {})[0]?.[0] ?? err.message)
          : 'Could not change the password',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-3">
      <Input
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        required
      />
      <div className="flex flex-col gap-1.5">
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <PasswordStrengthMeter password={next} />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={saving} className="self-start">
        Change password
      </Button>
    </form>
  );
}

/** For an account that skipped the optional recovery email at signup. */
function AddEmailForm({ onAdded }: { onAdded: (user: MeDto) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { user: updated } = await patch<{ user: MeDto }>(
        '/users/me/email',
        { email: email.trim() },
        { silent: true },
      );
      onAdded(updated);
      toast('Recovery email added — check your inbox to verify it', { kind: 'success' });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (Object.values(err.details ?? {})[0]?.[0] ?? err.message)
          : 'Could not add that email',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        No recovery email on this account. Adding one enables password recovery, magic-link sign-in,
        new-device protection, and two-factor login.
      </p>
      <div className="flex max-w-sm items-end gap-2">
        <Input
          label="Recovery email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          hint="Gmail addresses only"
          required
        />
        <Button type="submit" size="md" loading={saving}>
          Add
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function EmailBlock() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  if (!user) return null;

  if (!user.email) {
    return <AddEmailForm onAdded={setUser} />;
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-fg">
        {user.email}{' '}
        {user.emailVerified ? (
          <span className="ml-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
            Verified
          </span>
        ) : (
          <span className="ml-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
            Unverified
          </span>
        )}
      </p>
      {!user.emailVerified && (
        <Button
          variant="secondary"
          size="sm"
          loading={sending}
          onClick={() => {
            setSending(true);
            post('/auth/verify-email/resend', undefined, { silent: true })
              .then(() => toast('Verification email sent', { kind: 'success' }))
              .catch(() => toast('Could not send the email', { kind: 'error' }))
              .finally(() => setSending(false));
          }}
        >
          Resend verification
        </Button>
      )}
    </div>
  );
}

function TwoFactorBlock() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const requestStepUp = useStepUp();
  if (!user) return null;

  async function toggle(enable: boolean) {
    try {
      // §6.2 — disabling 2FA is step-up gated; enabling isn't sensitive the same way.
      const { user: updated } = await runWithStepUp(
        (stepUpToken) =>
          post<{ user: MeDto }>(enable ? '/auth/otp/enable' : '/auth/otp/disable', undefined, {
            ...(stepUpToken ? { stepUpToken } : {}),
            silent: true,
          }),
        requestStepUp,
      );
      setUser(updated);
      toast(enable ? 'Two-factor login enabled' : 'Two-factor login disabled', {
        kind: 'success',
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update 2FA', { kind: 'error' });
    }
  }

  return (
    <Switch
      label="Two-factor login (email OTP)"
      description={
        user.emailVerified
          ? 'Each sign-in also requires a 6-digit code emailed to you'
          : 'Requires a verified email'
      }
      checked={user.otpEnabled}
      disabled={!user.emailVerified}
      onChange={(value) => void toggle(value)}
    />
  );
}

function SessionsBlock() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestStepUp = useStepUp();
  const { data, isPending } = useQuery({
    queryKey: ['devices'],
    queryFn: () => get<{ items: DeviceDto[] }>('/auth/devices'),
  });

  async function revoke(id: string) {
    try {
      // §6.2 — revoking a session remotely is step-up gated.
      await runWithStepUp(
        (stepUpToken) => del(`/auth/devices/${id}`, stepUpToken ? { stepUpToken } : undefined),
        requestStepUp,
      );
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      toast('Session signed out', { kind: 'success' });
    } catch {
      toast('Could not revoke that session', { kind: 'error' });
    }
  }

  if (isPending) {
    return (
      <div aria-busy>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {data?.items.map((device) => (
        <li key={device.id} className="flex items-center justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg">
              {device.userAgent}
              {device.current && (
                <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
                  This device
                </span>
              )}
            </p>
            <p className="text-xs text-fg-muted">
              Last active {new Date(device.lastSeenAt).toLocaleString()}
            </p>
          </div>
          {!device.current && (
            <Button variant="secondary" size="sm" onClick={() => void revoke(device.id)}>
              Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function AuditLogBlock() {
  const { data, isPending } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => get<{ items: AuditLogEntryDto[] }>('/account/audit-log'),
  });

  if (isPending) {
    return (
      <div aria-busy>
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }
  if (!data?.items.length) {
    return <p className="text-sm text-fg-muted">No security events yet.</p>;
  }

  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
      {data.items.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-4 py-1">
          <span className="font-medium text-fg">{entry.eventType.replaceAll('_', ' ')}</span>
          <span className="shrink-0 text-xs text-fg-muted">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SecuritySection() {
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="sec-email">
        <h3 id="sec-email" className="mb-3 text-sm font-semibold text-fg">
          Recovery email
        </h3>
        <EmailBlock />
      </section>
      <section aria-labelledby="sec-2fa">
        <h3 id="sec-2fa" className="mb-1 text-sm font-semibold text-fg">
          Two-factor login
        </h3>
        <TwoFactorBlock />
      </section>
      <section aria-labelledby="sec-password">
        <h3 id="sec-password" className="mb-3 text-sm font-semibold text-fg">
          Password
        </h3>
        <ChangePasswordForm />
      </section>
      <section aria-labelledby="sec-sessions">
        <h3 id="sec-sessions" className="mb-1 text-sm font-semibold text-fg">
          Active sessions
        </h3>
        <p className="mb-3 text-xs text-fg-muted">
          Checking "Remember me" at sign-in keeps a session for 30 days; leaving it unchecked signs
          you out when you close your browser. Revoking a session here requires re-entering your
          password.
        </p>
        <SessionsBlock />
      </section>
      <section aria-labelledby="sec-audit">
        <h3 id="sec-audit" className="mb-3 text-sm font-semibold text-fg">
          Security log
        </h3>
        <AuditLogBlock />
      </section>
    </div>
  );
}
