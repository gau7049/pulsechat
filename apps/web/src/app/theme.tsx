import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type AccentName = 'pulse' | 'ocean' | 'forest' | 'sunset' | 'rose';

export const ACCENTS: readonly AccentName[] = ['pulse', 'ocean', 'forest', 'sunset', 'rose'];

interface ThemeContextValue {
  mode: ThemeMode;
  accent: AccentName;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: AccentName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'pulsechat.theme';

interface StoredTheme {
  mode: ThemeMode;
  accent: AccentName;
}

function loadStoredTheme(): StoredTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && 'mode' in parsed && 'accent' in parsed) {
        const candidate = parsed as StoredTheme;
        if (
          ['light', 'dark', 'system'].includes(candidate.mode) &&
          ACCENTS.includes(candidate.accent)
        ) {
          return candidate;
        }
      }
    }
  } catch {
    // Corrupt/unavailable storage falls back to defaults.
  }
  return { mode: 'system', accent: 'pulse' };
}

function applyTheme(mode: ThemeMode, accent: AccentName): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.accent = accent;
}

/**
 * Light/dark/system mode + accent palette, persisted locally (M1 syncs the
 * preference to the user account per Requirement Scope §14.9).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ mode, accent }, setTheme] = useState<StoredTheme>(loadStoredTheme);

  useEffect(() => {
    applyTheme(mode, accent);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, accent }));
    if (mode !== 'system') return;
    // Track OS scheme changes live while in system mode.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(mode, accent);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode, accent]);

  const setMode = useCallback((next: ThemeMode) => {
    setTheme((prev) => ({ ...prev, mode: next }));
  }, []);
  const setAccent = useCallback((next: AccentName) => {
    setTheme((prev) => ({ ...prev, accent: next }));
  }, []);

  const value = useMemo(
    () => ({ mode, accent, setMode, setAccent }),
    [mode, accent, setMode, setAccent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
