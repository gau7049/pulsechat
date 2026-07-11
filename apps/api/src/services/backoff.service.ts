import { cache } from '../lib/cache.js';
import { AppError } from '../http/errors.js';

/**
 * Brute-force protection on login (Requirement Scope §20, Technical Spec §5):
 * exponential backoff keyed by username+IP, tracked in the in-process cache.
 * 5 free attempts, then 2^n seconds of lockout capped at 15 minutes.
 */

interface BackoffState {
  failures: number;
  lockedUntil: number;
}

const FREE_ATTEMPTS = 5;
const MAX_LOCK_MS = 15 * 60 * 1000;
const STATE_TTL_SECONDS = 60 * 60;

function key(username: string, ip: string): string {
  return `bf:${username.toLowerCase()}:${ip}`;
}

/** Throws RATE_LIMITED when the caller is inside a lockout window. */
export function assertNotLockedOut(username: string, ip: string): void {
  const state = cache.get<BackoffState>(key(username, ip));
  if (state && state.lockedUntil > Date.now()) {
    const seconds = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    throw new AppError('RATE_LIMITED', `Too many failed attempts — try again in ${seconds}s`);
  }
}

export function recordLoginFailure(username: string, ip: string): void {
  const cacheKey = key(username, ip);
  const state = cache.get<BackoffState>(cacheKey) ?? { failures: 0, lockedUntil: 0 };
  state.failures += 1;
  if (state.failures > FREE_ATTEMPTS) {
    const lockMs = Math.min(2 ** (state.failures - FREE_ATTEMPTS) * 1000, MAX_LOCK_MS);
    state.lockedUntil = Date.now() + lockMs;
  }
  cache.set(cacheKey, state, STATE_TTL_SECONDS);
}

export function clearLoginFailures(username: string, ip: string): void {
  cache.del(key(username, ip));
}
