import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AppearanceSection } from './appearance-section';
import { BlockedSection } from './blocked-section';
import { PrivacySection } from './privacy-section';
import { ProfileSection } from './profile-section';
import { SecuritySection } from './security-section';

const TABS = [
  { path: 'profile', label: 'Profile' },
  { path: 'privacy', label: 'Privacy' },
  { path: 'blocked', label: 'Blocked' },
  { path: 'security', label: 'Security' },
  { path: 'appearance', label: 'Appearance' },
] as const;

/** Settings hub (Requirement Scope §16.1) with per-area sub-routes. */
export function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-fg">Settings</h1>

      <nav
        aria-label="Settings sections"
        className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-sunken p-1"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                isActive ? 'bg-surface-raised text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-6">
        <Routes>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSection />} />
          <Route path="privacy" element={<PrivacySection />} />
          <Route path="blocked" element={<BlockedSection />} />
          <Route path="security" element={<SecuritySection />} />
          <Route path="appearance" element={<AppearanceSection />} />
        </Routes>
      </div>
    </main>
  );
}
