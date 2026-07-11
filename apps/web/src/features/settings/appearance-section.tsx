import { ACCENTS, useTheme, type ThemeMode } from '../../app/theme';
import { Button } from '../../components/ui/button';

const MODES: ThemeMode[] = ['light', 'system', 'dark'];

/** Requirement Scope §14.9 — theme mode + accent, persisted per browser. */
export function AppearanceSection() {
  const { mode, setMode, accent, setAccent } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">Theme</h3>
        <div
          role="group"
          aria-label="Theme mode"
          className="inline-flex gap-1 rounded-xl bg-surface-sunken p-1"
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
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">Accent color</h3>
        <div role="group" aria-label="Accent color" className="flex gap-3">
          {ACCENTS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={accent === candidate}
              aria-label={`${candidate} accent`}
              data-accent={candidate}
              onClick={() => setAccent(candidate)}
              className={`size-9 rounded-full bg-accent transition-transform hover:scale-110 ${
                accent === candidate
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-raised'
                  : ''
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
