import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { AuthCard } from '../auth/auth-card';

/** Requirement Scope §16: "a separate account-restoration/sign-in confirmation flow". */
export function RequestRestorePage() {
  const [username, setUsername] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await post('/account/restore/request', { username: username.trim() });
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle="If that account is deleted and has a recovery email, a restoration link is on its way."
      >
        <Link to="/login" className="text-sm font-medium text-accent hover:text-accent-strong">
          Back to sign-in →
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Restore your account" subtitle="Enter the username of the deleted account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Button type="submit" loading={submitting} size="lg">
          Email me a restoration link
        </Button>
      </form>
    </AuthCard>
  );
}

export function ConfirmRestorePage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = params.get('token');
    if (!token) {
      setState('failed');
      return;
    }
    post('/account/restore/confirm', { token })
      .then(() => setState('done'))
      .catch(() => setState('failed'));
  }, [params]);

  return (
    <AuthCard title="Account restoration">
      {state === 'working' && <p className="text-sm text-fg-muted">Restoring your account…</p>}
      {state === 'done' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg">✅ Your account is restored. Sign in as usual.</p>
          <Link to="/login" className="text-sm font-medium text-accent hover:text-accent-strong">
            Sign in →
          </Link>
        </div>
      )}
      {state === 'failed' && (
        <p className="text-sm text-danger">
          This restoration link is invalid or has expired. Request a new one from the sign-in page.
        </p>
      )}
    </AuthCard>
  );
}
