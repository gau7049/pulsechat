import { LIMITS } from '@pulsechat/shared';
import { useTheme, ACCENTS, type ThemeMode } from '../../app/theme';
import { Avatar } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';

const MODES: ThemeMode[] = ['light', 'system', 'dark'];

/**
 * M0 shell home. Auth (M1) replaces this with the real signed-in experience;
 * until then it proves the token layer, theming, and primitives end-to-end.
 */
export function HomePage() {
  const { mode, setMode, accent, setAccent } = useTheme();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-on-accent"
          >
            P
          </span>
          <div>
            <h1 className="text-xl font-bold text-fg">PulseChat</h1>
            <p className="text-xs text-fg-muted">Private, real-time chat &amp; social</p>
          </div>
        </div>
        <Avatar name="PulseChat User" online={false} />
      </header>

      <section
        aria-label="Appearance"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-surface-raised p-5"
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-fg">Theme</span>
          <div
            role="group"
            aria-label="Theme mode"
            className="flex gap-1 rounded-xl bg-surface-sunken p-1"
          >
            {MODES.map((candidate) => (
              <Button
                key={candidate}
                size="sm"
                variant={mode === candidate ? 'primary' : 'ghost'}
                aria-pressed={mode === candidate}
                onClick={() => setMode(candidate)}
              >
                {candidate}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-fg">Accent</span>
          <div role="group" aria-label="Accent color" className="flex gap-2">
            {ACCENTS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={accent === candidate}
                aria-label={`${candidate} accent`}
                data-accent={candidate}
                onClick={() => setAccent(candidate)}
                className={`size-7 rounded-full bg-accent transition-transform hover:scale-110 ${
                  accent === candidate
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised'
                    : ''
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="flex-1 rounded-2xl border border-border bg-surface-raised">
        <EmptyState
          icon="💬"
          title="Nothing here yet"
          description={`Milestone M0 is the foundation. Sign-up, friends, and chats (with files up to ${Math.round(
            LIMITS.MAX_UPLOAD_BYTES / (1024 * 1024),
          )} MB) arrive over the next milestones.`}
          action={<Button disabled>Create account — coming in M1</Button>}
        />
      </section>
    </main>
  );
}
