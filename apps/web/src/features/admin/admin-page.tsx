import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AnalyticsDashboard } from './analytics-dashboard';
import { ReportsQueue } from './reports-queue';

const TABS = [
  { path: 'reports', label: 'Reports' },
  { path: 'analytics', label: 'Analytics' },
] as const;

/**
 * Admin console — a JWT-role-gated route, not a separate SPA (Technical Spec
 * §1). Reports queue (§18) + analytics dashboard (§18.1).
 */
export function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Admin</h1>

      <nav aria-label="Admin sections" className="mt-4 flex gap-1 rounded-xl bg-surface-sunken p-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/admin/${tab.path}`}
            className={({ isActive }) =>
              `rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <Routes>
          <Route index element={<Navigate to="reports" replace />} />
          <Route path="reports" element={<ReportsQueue />} />
          <Route path="analytics" element={<AnalyticsDashboard />} />
        </Routes>
      </div>
    </main>
  );
}
