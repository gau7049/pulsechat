import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '../components/ui/toast';
import { AuthProvider } from '../features/auth/auth-context';
import { ServiceWorkerUpdateWatcher } from '../features/pwa/use-sw-update';
import { ThemeProvider } from './theme';

/**
 * Application-wide providers. Server state lives in TanStack Query (cache
 * invalidation will be tied to socket events from M3); auth and socket
 * providers join here in M1/M3.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <ServiceWorkerUpdateWatcher />
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
