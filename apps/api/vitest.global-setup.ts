import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/**
 * Integration-test database setup (Technical Spec §19): tests run against a
 * dedicated `pulsechat_test` schema — locally that lives on the same Supabase
 * instance as dev; in CI it's the ephemeral postgres service. The schema is
 * force-reset to the current Prisma schema before the run.
 */
export default function globalSetup(): void {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  config({ path: path.join(repoRoot, '.env') });

  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL (or TEST_DATABASE_URL) must be set to run API tests');
  }
  const url = new URL(base);
  if (!process.env.TEST_DATABASE_URL) {
    url.searchParams.set('schema', 'pulsechat_test');
  }
  const testUrl = url.toString();

  execSync('pnpm exec prisma db push --skip-generate --force-reset --accept-data-loss', {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });

  // Workers inherit this env; dotenv in app code never overrides it.
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  // Force provider fallbacks: CAPTCHA skipped, emails captured by mocks.
  // Empty string (not delete): dotenv in the worker would re-load a deleted
  // variable from .env, while an existing value is never overridden — and
  // parseEnv treats empty strings as absent.
  process.env.TURNSTILE_SECRET = '';
  process.env.BREVO_API_KEY = '';
  // Deterministic signing secrets when the environment provides none (CI).
  process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-test-access-secret-0123456789';
  process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-test-refresh-secret-0123456789';
}
