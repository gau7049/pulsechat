import { createBrowserRouter } from 'react-router-dom';
import { ConfirmRestorePage, RequestRestorePage } from '../features/account/restore-landing-pages';
import { AdminPage } from '../features/admin/admin-page';
import { RequireAdmin } from '../features/admin/admin-guard';
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
import { ChatsPage } from '../features/chat/chats-page';
import { StarredMessagesPage } from '../features/chat/starred-messages-page';
import { PrivacyPolicyPage, TermsPage } from '../features/legal/legal-pages';
import { NotificationsPage } from '../features/notifications/notifications-page';
import { ExplorePage } from '../features/posts/explore-page';
import { HashtagPage } from '../features/posts/hashtag-page';
import { LikedPostsPage } from '../features/posts/liked-posts-page';
import { PostDetailPage } from '../features/posts/post-detail-page';
import { SavedPostsPage } from '../features/posts/saved-posts-page';
import { SettingsPage } from '../features/settings/settings-page';
import { InviteLandingPage } from '../features/social/invite-landing-page';
import { PeoplePage } from '../features/social/people-page';
import { ProfilePage } from '../features/social/profile-page';
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
      { path: 'restore-account', element: <RequestRestorePage /> },
      { path: 'restore-account/confirm', element: <ConfirmRestorePage /> },
      // Invite landing works signed in or out (§10.3).
      { path: 'invite/:code', element: <InviteLandingPage /> },
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
            children: [
              { path: 'settings/*', element: <SettingsPage /> },
              { path: 'people/*', element: <PeoplePage /> },
              { path: 'u/:username', element: <ProfilePage /> },
              { path: 'chats', element: <ChatsPage /> },
              { path: 'chats/starred', element: <StarredMessagesPage /> },
              { path: 'chats/:id', element: <ChatsPage /> },
              { path: 'notifications', element: <NotificationsPage /> },
              { path: 'explore', element: <ExplorePage /> },
              { path: 'hashtag/:tag', element: <HashtagPage /> },
              { path: 'p/:id', element: <PostDetailPage /> },
              { path: 'posts/liked', element: <LikedPostsPage /> },
              { path: 'posts/saved', element: <SavedPostsPage /> },
              {
                element: <RequireAdmin />,
                children: [{ path: 'admin/*', element: <AdminPage /> }],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
