import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { AuthCard } from './auth-card';
import { useAuth } from './auth-context';
import { TurnstileWidget, turnstileEnabled } from './turnstile-widget';

type Stage =
  | { name: 'credentials' }
  | { name: 'otp'; pendingToken: string }
  | { name: 'device_pending'; maskedEmail: string }
  | { name: 'magic_sent'; email: string };

export function LoginPage() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>({ name: 'credentials' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [magicEmail, setMagicEmail] = useState('');
  const [showMagic, setShowMagic] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onPasswordSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (turnstileEnabled && !turnstileToken) {
      setError('Complete the CAPTCHA to continue');
      return;
    }
    setSubmitting(true);
    try {
      const result = await login(username.trim(), password, turnstileToken ?? undefined);
      if (result.kind === 'session') {
        navigate('/', { replace: true });
      } else if (result.kind === 'otp_required') {
        setStage({ name: 'otp', pendingToken: result.pendingToken });
      } else {
        setStage({ name: 'device_pending', maskedEmail: result.maskedEmail });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function onOtpSubmit(event: FormEvent) {
    event.preventDefault();
    if (stage.name !== 'otp') return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtp(stage.pendingToken, otpCode.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function onMagicSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await post('/auth/magic-link', {
        email: magicEmail.trim(),
        turnstileToken: turnstileToken ?? undefined,
      });
      setStage({ name: 'magic_sent', email: magicEmail.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.details?.email) {
        setError(err.details.email[0] ?? err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Could not send the link');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (stage.name === 'otp') {
    return (
      <AuthCard title="Enter your code" subtitle="We emailed a 6-digit code to your address.">
        <form onSubmit={onOtpSubmit} className="flex flex-col gap-4">
          <Input
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
            className="text-center text-lg tracking-[0.5em]"
            required
          />
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} size="lg" disabled={otpCode.length !== 6}>
            Verify
          </Button>
          <Button variant="ghost" type="button" onClick={() => setStage({ name: 'credentials' })}>
            Back to sign-in
          </Button>
        </form>
      </AuthCard>
    );
  }

  if (stage.name === 'device_pending') {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We've sent an email to ${stage.maskedEmail} — please confirm it's you.`}
      >
        <div className="flex flex-col gap-4 text-sm text-fg-muted">
          <p>
            This device isn't recognized yet. Open the confirmation link we emailed you, then sign
            in again here.
          </p>
          <Button onClick={() => setStage({ name: 'credentials' })}>
            I've confirmed — sign in
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (stage.name === 'magic_sent') {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If ${stage.email} has an account, a sign-in link is on its way.`}
      >
        <div className="flex flex-col gap-4 text-sm text-fg-muted">
          <p>The link signs you in with one tap and expires in 15 minutes.</p>
          <Button variant="ghost" onClick={() => setStage({ name: 'credentials' })}>
            Back to sign-in
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Welcome back"
      footer={
        <>
          New to PulseChat?{' '}
          <Link to="/register" className="font-medium text-accent hover:text-accent-strong">
            Create an account
          </Link>
        </>
      }
    >
      {showMagic ? (
        <form onSubmit={onMagicSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={magicEmail}
            onChange={(e) => setMagicEmail(e.target.value)}
            hint="We'll email you a one-tap sign-in link"
            required
          />
          <TurnstileWidget onToken={setTurnstileToken} />
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} size="lg">
            Email me a sign-in link
          </Button>
          <Button variant="ghost" type="button" onClick={() => setShowMagic(false)}>
            Use password instead
          </Button>
        </form>
      ) : (
        <form onSubmit={onPasswordSubmit} className="flex flex-col gap-4">
          <Input
            label="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={() => setShowMagic(true)}
              className="text-accent hover:text-accent-strong"
            >
              Email me a link instead
            </button>
            <Link to="/forgot-password" className="text-accent hover:text-accent-strong">
              Forgot password?
            </Link>
          </div>
          <Link to="/restore-account" className="text-sm text-fg-muted hover:text-fg">
            Restore a deleted account
          </Link>
          <TurnstileWidget onToken={setTurnstileToken} />
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} size="lg">
            Sign in
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
