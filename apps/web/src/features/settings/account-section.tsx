import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, get, post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';

function DangerAction({
  action,
  title,
  description,
  confirmLabel,
  onConfirmed,
}: {
  action: 'deactivate' | 'delete';
  title: string;
  description: string;
  confirmLabel: string;
  onConfirmed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await post(`/account/${action}`, { currentPassword: password });
      onConfirmed();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (Object.values(err.details ?? {})[0]?.[0] ?? err.message)
          : 'Something went wrong',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-fg-muted">{description}</p>
      <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        {confirmLabel}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">{description}</p>
          <Input
            label="Confirm your password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={submitting}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ExportBlock() {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      const data = await get<Record<string, unknown>>('/account/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'pulsechat-export.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('Could not export your data', { kind: 'error' });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-fg-muted">
        Download your profile, posts, and message history (ciphertext + metadata — only this
        device's key can decrypt message bodies).
      </p>
      <Button variant="secondary" size="sm" className="mt-3" loading={exporting} onClick={onExport}>
        Download my data
      </Button>
    </div>
  );
}

/** Settings → Account (Requirement Scope §16). */
export function AccountSection() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="acc-logout">
        <h3 id="acc-logout" className="mb-1 text-sm font-semibold text-fg">
          Log out
        </h3>
        <p className="text-sm text-fg-muted">Sign out of PulseChat on this device.</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => {
            void logout().then(() => navigate('/login'));
          }}
        >
          Log out
        </Button>
      </section>
      <section aria-labelledby="acc-export">
        <h3 id="acc-export" className="mb-1 text-sm font-semibold text-fg">
          Data export
        </h3>
        <ExportBlock />
      </section>
      <section aria-labelledby="acc-deactivate">
        <h3 id="acc-deactivate" className="mb-1 text-sm font-semibold text-fg">
          Deactivate account
        </h3>
        <DangerAction
          action="deactivate"
          title="Deactivate your account?"
          description="Your profile becomes invisible to everyone, including friends. Simply logging back in restores it automatically."
          confirmLabel="Deactivate"
          onConfirmed={() => void logout()}
        />
      </section>
      <section aria-labelledby="acc-delete">
        <h3 id="acc-delete" className="mb-1 text-sm font-semibold text-fg">
          Delete account
        </h3>
        <DangerAction
          action="delete"
          title="Delete your account?"
          description="Your account is soft-deleted, not restored by a normal login. You'll need the account-restoration email flow to reclaim it."
          confirmLabel="Delete account"
          onConfirmed={() => {
            toast('Account deleted', { kind: 'success' });
            void logout();
          }}
        />
      </section>
    </div>
  );
}
