import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { setApiErrorHandler } from '../../lib/api';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastOptions {
  kind?: ToastKind;
  /** Optional action, e.g. Undo after a destructive action (Scope §20). */
  actionLabel?: string;
  onAction?: () => void;
  /** Pass `null` to keep the toast until manually dismissed (✕ or the action
   * button) — for things the user shouldn't miss by looking away for 5s. */
  durationMs?: number | null;
}

interface ToastItem extends Required<Pick<ToastOptions, 'kind'>> {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const kindClasses: Record<ToastKind, string> = {
  info: 'border-border',
  success: 'border-success',
  error: 'border-danger',
};

/** App-wide toast/snackbar host; renders into a polite live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        message,
        kind: options.kind ?? 'info',
        actionLabel: options.actionLabel,
        onAction: options.onAction,
      };
      setItems((prev) => [...prev, item]);
      if (options.durationMs !== null) {
        window.setTimeout(() => dismiss(id), options.durationMs ?? 5000);
      }
    },
    [dismiss],
  );

  useEffect(() => {
    setApiErrorHandler((message) => toast(message, { kind: 'error' }));
    return () => setApiErrorHandler(null);
  }, [toast]);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border bg-surface-raised px-4 py-3 text-sm text-fg shadow-lg ${kindClasses[item.kind]}`}
          >
            <span className="flex-1">{item.message}</span>
            {item.actionLabel && (
              <button
                type="button"
                className="font-semibold text-accent hover:text-accent-strong"
                onClick={() => {
                  item.onAction?.();
                  dismiss(item.id);
                }}
              >
                {item.actionLabel}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              title="Dismiss"
              className="text-fg-muted hover:text-fg"
              onClick={() => dismiss(item.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
