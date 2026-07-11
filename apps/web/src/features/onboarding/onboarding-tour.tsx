import { useState } from 'react';
import { post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { useAuth } from '../auth/auth-context';
import type { MeDto } from '@pulsechat/shared';

/**
 * First-login guided tour (§6.7): highlights the core features, skippable at
 * any point, shown once per account.
 */
const STEPS = [
  {
    icon: '👤',
    title: 'Make it yours',
    body: 'Set a photo, bio, and visibility in Settings → Profile. You control who sees what.',
  },
  {
    icon: '🔍',
    title: 'Find your people',
    body: 'Search by username or name, send a friend request — chat unlocks once you both connect.',
  },
  {
    icon: '💬',
    title: 'Private by design',
    body: 'Messages are encrypted at rest. Nobody — not even PulseChat admins — can read your chats.',
  },
  {
    icon: '✨',
    title: 'Share your day',
    body: '24-hour statuses with music and drawings, live broadcasts, and a posts feed with hashtags.',
  },
  {
    icon: '🛡️',
    title: 'Stay in control',
    body: 'Fine-grained privacy settings, blocking, session management, and a security log — all in Settings.',
  },
] as const;

export function OnboardingTour() {
  const { setUser } = useAuth();
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  async function finish() {
    setClosing(true);
    try {
      const { user } = await post<{ user: MeDto }>('/users/me/onboarded');
      setUser(user);
    } catch {
      // If the call fails the tour just shows again next session — harmless.
      setClosing(false);
    }
  }

  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome tour"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-raised p-6 shadow-xl">
        <p className="text-4xl" aria-hidden>
          {current.icon}
        </p>
        <h2 className="mt-3 text-lg font-bold text-fg">{current.title}</h2>
        <p className="mt-1 text-sm text-fg-muted">{current.body}</p>

        <div className="mt-4 flex gap-1" aria-hidden>
          {STEPS.map((_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full ${index <= step ? 'bg-accent' : 'bg-fg-muted/20'}`}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={finish} loading={closing && !last}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button size="sm" onClick={finish} loading={closing}>
                Get started
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
