import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Last-resort error UI (Build Instructions §7: never a raw stack trace).
 * Route-level errors are handled by the router's errorElement; this catches
 * anything that escapes.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Replaced by structured client telemetry later; console.error is the
    // deliberate dev-visible sink for unexpected render crashes.
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
          <p className="text-5xl" aria-hidden>
            ⚡
          </p>
          <h1 className="text-2xl font-bold text-fg">Something broke on our side</h1>
          <p className="max-w-sm text-sm text-fg-muted">
            The page hit an unexpected error. Reloading usually fixes it — your messages are safe.
          </p>
          <Button onClick={() => window.location.reload()}>Reload PulseChat</Button>
        </main>
      );
    }
    return this.props.children;
  }
}
