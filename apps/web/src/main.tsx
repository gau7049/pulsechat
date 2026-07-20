import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { AppErrorBoundary } from './app/error-boundary';
import { AppProviders } from './app/providers';
import { router } from './app/router';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root element missing from index.html');

// Registered unconditionally (not just when Settings → Notifications mounts)
// so offline caching works from the first visit and the browser's PWA
// install-eligibility check (which requires an active SW registration) can
// actually fire — see apps/web/public/sw.js for what it does.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </AppErrorBoundary>
  </StrictMode>,
);
