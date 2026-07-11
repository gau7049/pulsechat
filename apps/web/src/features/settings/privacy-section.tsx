import type { MeDto } from '@pulsechat/shared';
import { patch } from '../../lib/api';
import { Switch } from '../../components/ui/switch';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';

function Select<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && <span className="block text-xs text-fg-muted">{description}</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 rounded-lg border border-border bg-surface-raised px-2 text-sm text-fg"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Requirement Scope §8 — every privacy control, saved optimistically. */
export function PrivacySection() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  if (!user) return null;
  const privacy = user.privacy;

  async function update(partial: Record<string, unknown>) {
    try {
      const { user: updated } = await patch<{ user: MeDto }>('/users/me/privacy', partial);
      setUser(updated);
    } catch {
      toast('Could not save that setting — try again', { kind: 'error' });
    }
  }

  return (
    <div className="flex flex-col divide-y divide-border">
      <Select
        label="Who can send friend requests"
        value={privacy.whoCanSendRequests}
        options={[
          { value: 'public', label: 'Everyone' },
          { value: 'friends', label: 'Friends of friends' },
          { value: 'private', label: 'No one' },
        ]}
        onChange={(value) => void update({ whoCanSendRequests: value })}
      />
      <Switch
        label="Show email on profile"
        description={user.email ? undefined : 'Add a recovery email first'}
        checked={privacy.emailVisible}
        disabled={!user.email}
        onChange={(value) => void update({ emailVisible: value })}
      />
      <Switch
        label="Show birth date on profile"
        checked={privacy.birthdateVisible}
        onChange={(value) => void update({ birthdateVisible: value })}
      />
      <Select
        label="Online status & last seen"
        description="Who can see when you're online"
        value={privacy.lastSeenVisibility}
        options={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'friends', label: 'Friends only' },
          { value: 'no_one', label: 'No one' },
        ]}
        onChange={(value) => void update({ lastSeenVisibility: value })}
      />
      <Select
        label="Default status visibility"
        description="Audience for your 24-hour statuses"
        value={privacy.statusVisibility}
        options={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'friends', label: 'Friends only' },
        ]}
        onChange={(value) => void update({ statusVisibility: value })}
      />
      <Switch
        label="Read receipts"
        description="Turning this off also hides others' read receipts from you"
        checked={privacy.readReceipts}
        onChange={(value) => void update({ readReceipts: value })}
      />
    </div>
  );
}
