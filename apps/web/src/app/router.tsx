import { createBrowserRouter } from 'react-router-dom';
import { NotFoundPage } from '../features/errors/not-found-page';
import { RouteErrorPage } from '../features/errors/route-error-page';
import { HomePage } from '../features/home/home-page';

/**
 * Route table. Feature routes (auth, chat, feed, admin…) are added milestone
 * by milestone; `*` keeps the custom 404 as the catch-all.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
