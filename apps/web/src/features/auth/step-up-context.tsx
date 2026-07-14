import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { ApiError, post } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';

/**
 * §6.2 step-up re-auth: a generic password-confirm modal for sensitive
 * actions that fail with `STEP_UP_REQUIRED` (session revoke, 2FA disable).
 * Mounted once in the app shell, same pattern as `CallOverlay`.
 */

interface StepUpContextValue {
  requestStepUp: () => Promise<string>;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const resolver = useRef<{ resolve: (token: string) => void; reject: () => void } | null>(null);

  const requestStepUp = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      resolver.current = { resolve, reject };
      setPassword('');
      setError(null);
      setOpen(true);
    });
  }, []);

  function cancel(): void {
    resolver.current?.reject();
    resolver.current = null;
    setOpen(false);
  }

  async function confirm(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { stepUpToken } = await post<{ stepUpToken: string }>('/auth/step-up', { password });
      resolver.current?.resolve(stepUpToken);
      resolver.current = null;
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Incorrect password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <StepUpContext.Provider value={{ requestStepUp }}>
      {children}
      <Modal open={open} onClose={cancel} title="Confirm your password">
        <form onSubmit={(e) => void confirm(e)} className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            This action needs a fresh password check for your security.
          </p>
          <Input
            label="Password"
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={cancel}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Confirm
            </Button>
          </div>
        </form>
      </Modal>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): () => Promise<string> {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used within StepUpProvider');
  return ctx.requestStepUp;
}

/** Runs `action`; on a STEP_UP_REQUIRED rejection, prompts once and retries with the token. */
export async function runWithStepUp<T>(
  action: (stepUpToken?: string) => Promise<T>,
  requestStepUp: () => Promise<string>,
): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'STEP_UP_REQUIRED') {
      const token = await requestStepUp();
      return action(token);
    }
    throw err;
  }
}
