import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { MeDto, Visibility } from '@pulsechat/shared';
import { ApiError, patch, post } from '../../lib/api';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { useAuth } from '../auth/auth-context';

interface SignedUpload {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  folder: string;
  publicId: string;
  signature: string;
  uploadUrl: string;
}

const VISIBILITIES: Array<{ value: Visibility; label: string; description: string }> = [
  { value: 'public', label: 'Public', description: 'Anyone can find and view your profile' },
  { value: 'friends', label: 'Friends only', description: 'Only accepted friends see details' },
  { value: 'private', label: 'Private', description: 'Hidden from unknown users entirely' },
];

export function ProfileSection() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [country, setCountry] = useState(user?.country ?? '');
  const [state, setState] = useState(user?.state ?? '');
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? '');
  const [visibility, setVisibility] = useState<Visibility>(user?.visibility ?? 'public');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const { user: updated } = await patch<{ user: MeDto }>('/users/me', {
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        country: country.trim() || null,
        state: state.trim() || null,
        birthDate: birthDate || null,
        visibility,
      });
      setUser(updated);
      toast('Profile saved', { kind: 'success' });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (Object.values(err.details ?? {})[0]?.[0] ?? err.message)
          : 'Could not save profile',
      );
    } finally {
      setSaving(false);
    }
  }

  async function onAvatarPicked(file: File) {
    setUploading(true);
    setError(null);
    try {
      const signed = await post<SignedUpload>('/users/me/avatar-upload-token');
      const form = new FormData();
      form.set('file', file);
      form.set('api_key', signed.apiKey);
      form.set('timestamp', String(signed.timestamp));
      form.set('signature', signed.signature);
      form.set('folder', signed.folder);
      form.set('public_id', signed.publicId);
      form.set('overwrite', 'true');

      const upload = await fetch(signed.uploadUrl, { method: 'POST', body: form });
      if (!upload.ok) throw new Error('Upload failed');
      const result = (await upload.json()) as { secure_url: string };

      const { user: updated } = await patch<{ user: MeDto }>('/users/me/avatar', {
        avatarUrl: result.secure_url,
      });
      setUser(updated);
      toast('Profile photo updated', { kind: 'success' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photo');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSave} className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Avatar name={user.displayName} src={user.avatarUrl} size="xl" />
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            Change photo
          </Button>
          <p className="text-xs text-fg-muted">JPG or PNG, up to 10 MB</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onAvatarPicked(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <Input label="Username" value={user.username} disabled hint="Usernames can't be changed" />
      <Input
        label="Display name"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-sm font-medium text-fg">
          Bio
        </label>
        <textarea
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={300}
          rows={3}
          className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:border-accent"
          placeholder="A line about you"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
        <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
      </div>
      <Input
        label="Birth date"
        type="date"
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
      />

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-fg">Profile visibility</legend>
        <div className="flex flex-col gap-2">
          {VISIBILITIES.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                visibility === option.value ? 'border-accent bg-accent-soft/50' : 'border-border'
              }`}
            >
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={visibility === option.value}
                onChange={() => setVisibility(option.value)}
                className="mt-1 accent-(--accent)"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{option.label}</span>
                <span className="block text-xs text-fg-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* §13.5 "Settings includes a view" for liked/saved posts. */}
      <div className="flex gap-4 text-sm">
        <Link to="/posts/liked" className="font-medium text-accent hover:text-accent-strong">
          Posts I've liked
        </Link>
        <Link to="/posts/saved" className="font-medium text-accent hover:text-accent-strong">
          Saved posts
        </Link>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" loading={saving} className="self-start">
        Save profile
      </Button>
    </form>
  );
}
