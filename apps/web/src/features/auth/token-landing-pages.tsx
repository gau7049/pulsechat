import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { AuthCard } from './auth-card';
import { useAuth } from './auth-context';
import { PasswordStrengthMeter } from './password-strength-meter';
import { TurnstileWidget, turnstileEnabled } from './turnstile-widget';

/** Landing pages for tokens that arrive via email links. */

type TokenState = 'working' | 'done' | 'failed';

function useTokenAction(action: (token: string) => Promise<void>): TokenState {
  const [params] = useSearchParams();
  const [state, setState] = useState<TokenState>('working');
  const ran = useRef(false);

  useEffect(() => {
    // Strict-mode double-invoke guard: these tokens are single-use.
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      setState('failed');
      return;
    }
    action(token)
      .then(() => setState('done'))
      .catch(() => setState('failed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}

export function VerifyEmailPage() {
  const state = useTokenAction((token) => post('/auth/verify-email', { token }));
  return (
    <AuthCard title="Email verification">
      {state === 'working' && <p className="text-sm text-fg-muted">Verifying your email…</p>}
      {state === 'done' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg">
            ✅ Your email is verified. Recovery, magic-link sign-in, and 2FA are now available.
          </p>
          <Link to="/" className="text-sm font-medium text-accent hover:text-accent-strong">
            Continue to PulseChat →
          </Link>
        </div>
      )}
      {state === 'failed' && (
        <p className="text-sm text-danger">
          This verification link is invalid or has expired. You can request a new one from Settings
          → Security.
        </p>
      )}
    </AuthCard>
  );
}

export function MagicLinkPage() {
  const { verifyMagicLink } = useAuth();
  const navigate = useNavigate();
  const state = useTokenAction(async (token) => {
    await verifyMagicLink(token);
    navigate('/', { replace: true });
  });
  return (
    <AuthCard title="Signing you in">
      {state === 'working' && <p className="text-sm text-fg-muted">Checking your sign-in link…</p>}
      {state === 'failed' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-danger">This sign-in link is invalid or has expired.</p>
          <Link to="/login" className="text-sm font-medium text-accent hover:text-accent-strong">
            Back to sign-in →
          </Link>
        </div>
      )}
    </AuthCard>
  );
}

export function ConfirmDevicePage() {
  const state = useTokenAction((token) => post('/auth/confirm-device', { token }));
  return (
    <AuthCard title="New device confirmation">
      {state === 'working' && <p className="text-sm text-fg-muted">Confirming this was you…</p>}
      {state === 'done' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg">
            ✅ Device confirmed. Return to your new device and sign in again — it will go straight
            through.
          </p>
          <Link to="/login" className="text-sm font-medium text-accent hover:text-accent-strong">
            Sign in →
          </Link>
        </div>
      )}
      {state === 'failed' && (
        <p className="text-sm text-danger">
          This confirmation link is invalid or has expired. Sign in again to receive a fresh one —
          and if you don't recognize the attempt, change your password now.
        </p>
      )}
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (turnstileEnabled && !turnstileToken) {
      setError('Complete the CAPTCHA to continue');
      return;
    }
    setSubmitting(true);
    try {
      await post('/auth/forgot-password', {
        email: email.trim(),
        turnstileToken: turnstileToken ?? undefined,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If ${email} has an account, a reset link is on its way.`}
      >
        <Link to="/login" className="text-sm font-medium text-accent hover:text-accent-strong">
          Back to sign-in →
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter the recovery email on your account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <TurnstileWidget onToken={setTurnstileToken} />
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" loading={submitting} size="lg">
          Email me a reset link
        </Button>
      </form>
    </AuthCard>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await post('/auth/reset-password', { token: params.get('token'), newPassword });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <PasswordStrengthMeter password={newPassword} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" loading={submitting} size="lg">
          Set new password
        </Button>
      </form>
    </AuthCard>
  );
}
