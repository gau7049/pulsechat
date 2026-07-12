import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';

/**
 * Admin-only routes (Technical Spec §1: "a route gated by an admin-only JWT
 * claim", not a separate SPA build). Nested inside `RequireAuth`, so `user`
 * is always present here.
 */
export function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}
