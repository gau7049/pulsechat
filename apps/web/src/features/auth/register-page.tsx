import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerBodySchema } from '@pulsechat/shared';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { AuthCard } from './auth-card';
import { useAuth } from './auth-context';
import { PasswordStrengthMeter } from './password-strength-meter';
import { TurnstileWidget, turnstileEnabled } from './turnstile-widget';

type FieldErrors = Partial<Record<string, string>>;

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [consent, setConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const candidate = {
      username,
      displayName,
      password,
      email: email || undefined,
      birthDate: birthDate || undefined,
      consent: consent as true,
      publicKey: 'x'.repeat(44), // placeholder for pre-validation only
      turnstileToken: turnstileToken ?? undefined,
    };
    const parsed = registerBodySchema.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0]?.toString() ?? 'form';
        fieldErrors[field] ??= issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setFormError('Complete the CAPTCHA to continue');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        email: email.trim() || undefined,
        birthDate: birthDate || undefined,
        turnstileToken: turnstileToken ?? undefined,
      });
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.details) {
        const fieldErrors: FieldErrors = {};
        for (const [field, messages] of Object.entries(error.details)) {
          fieldErrors[field] = messages[0];
        }
        setErrors(fieldErrors);
      } else {
        setFormError(error instanceof Error ? error.message : 'Registration failed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Chat privately, share your day, go live."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-accent hover:text-accent-strong">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          error={errors.username}
          hint="Letters, numbers, underscores, periods — 3 to 20 characters"
          required
        />
        <Input
          label="Display name"
          autoComplete="name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={errors.displayName}
          required
        />
        <div className="flex flex-col gap-1.5">
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            required
          />
          <PasswordStrengthMeter password={password} />
        </div>
        <Input
          label="Recovery email (optional)"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          hint="Gmail only. Enables account recovery, magic-link sign-in, and 2FA"
        />
        <Input
          label="Birth date (optional)"
          type="date"
          value={birthDate}
          onChange={(e) => setBirthDate(e.target.value)}
          error={errors.birthDate}
        />

        <label className="flex items-start gap-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-4 accent-(--accent)"
            required
          />
          <span>
            I agree to the{' '}
            <Link to="/terms" className="text-accent hover:text-accent-strong" target="_blank">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-accent hover:text-accent-strong" target="_blank">
              Privacy Policy
            </Link>
          </span>
        </label>
        {errors.consent && !consent && (
          <p role="alert" className="text-xs text-danger">
            {errors.consent}
          </p>
        )}

        <TurnstileWidget onToken={setTurnstileToken} />

        {formError && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        <Button type="submit" loading={submitting} size="lg">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
