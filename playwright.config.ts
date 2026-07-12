import { defineConfig, devices } from '@playwright/test';

/**
 * Local-only e2e config (ROADMAP M8) — not run in CI (see ROADMAP's M8 scope
 * note on keeping CI fast / within the free-tier's CI-minutes cap). Starts
 * both dev servers and drives a real browser through signup→friend→chat→post,
 * exercising the real client-side E2E encryption pipeline end to end.
 *
 * One-time setup before first run: `pnpm exec playwright install chromium`.
 * Precondition: both TURNSTILE_SECRET and VITE_TURNSTILE_SITE_KEY must be
 * unset in .env for the run — a real Turnstile challenge can't be solved by
 * Playwright (same constraint as the Artillery load test, see
 * artillery/socket-sanity.yml).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @pulsechat/api dev',
      url: 'http://localhost:4000/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @pulsechat/web dev',
      url: 'http://localhost:8000',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
