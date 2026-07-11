import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SkeletonRow } from '../../components/ui/skeleton';
import { useAuth } from './auth-context';

/** Content-shaped placeholder while the silent session restore runs. */
function RestoreSkeleton() {
  return (
    <main aria-busy className="mx-auto w-full max-w-2xl px-4 py-10">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </main>
  );
}

/** Routes that require a signed-in user. */
export function RequireAuth() {
  const { user, restoring } = useAuth();
  const location = useLocation();
  if (restoring) return <RestoreSkeleton />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Routes that only make sense signed out (login/register). */
export function GuestOnly() {
  const { user, restoring } = useAuth();
  if (restoring) return <RestoreSkeleton />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
