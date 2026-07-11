import { passwordStrength, type PasswordStrength } from '@pulsechat/shared';

const LEVELS: PasswordStrength[] = ['weak', 'fair', 'good', 'strong'];

const meta: Record<PasswordStrength, { label: string; color: string }> = {
  weak: { label: 'Weak', color: 'bg-danger' },
  fair: { label: 'Fair', color: 'bg-warning' },
  good: { label: 'Good', color: 'bg-accent' },
  strong: { label: 'Strong', color: 'bg-success' },
};

/** Live strength meter (§6.1) — same scoring function the server validates with. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const strength = passwordStrength(password);
  const level = LEVELS.indexOf(strength);

  return (
    <div aria-live="polite" className="flex items-center gap-2">
      <div className="flex flex-1 gap-1" aria-hidden>
        {LEVELS.map((_, index) => (
          <span
            key={index}
            className={`h-1 flex-1 rounded-full transition-colors ${
              index <= level ? meta[strength].color : 'bg-fg-muted/20'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-fg-muted">{meta[strength].label}</span>
    </div>
  );
}
