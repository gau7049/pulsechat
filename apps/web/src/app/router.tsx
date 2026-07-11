import { createBrowserRouter } from 'react-router-dom';
import { GuestOnly, RequireAuth } from '../features/auth/guards';
import { LoginPage } from '../features/auth/login-page';
import { RegisterPage } from '../features/auth/register-page';
import {
  ConfirmDevicePage,
  ForgotPasswordPage,
  MagicLinkPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from '../features/auth/token-landing-pages';
import { NotFoundPage } from '../features/errors/not-found-page';
import { RouteErrorPage } from '../features/errors/route-error-page';
import { HomePage } from '../features/home/home-page';
import { PrivacyPolicyPage, TermsPage } from '../features/legal/legal-pages';
import { SettingsPage } from '../features/settings/settings-page';
import { AppShell } from './app-shell';

export const router = createBrowserRouter([
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      // Guest-only auth screens.
      {
        element: <GuestOnly />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
        ],
      },
      // Email-link landing pages work signed in or out.
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'magic-link', element: <MagicLinkPage /> },
      { path: 'confirm-device', element: <ConfirmDevicePage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'terms', element: <TermsPage /> },
      { path: 'privacy', element: <PrivacyPolicyPage /> },
      // The home route renders the guest landing when signed out.
      {
        element: <AppShell />,
        children: [{ index: true, element: <HomePage /> }],
      },
      // Signed-in-only areas.
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [{ path: 'settings/*', element: <SettingsPage /> }],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
