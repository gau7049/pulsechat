import { z } from 'zod';
import { LIMITS, RESERVED_USERNAMES } from '../constants.js';

/**
 * Username rules (Requirement Scope §6.1): allowed characters, length bounds,
 * and a reserved-word blocklist. Uniqueness is enforced by the database.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(LIMITS.USERNAME_MIN, `Username must be at least ${LIMITS.USERNAME_MIN} characters`)
  .max(LIMITS.USERNAME_MAX, `Username must be at most ${LIMITS.USERNAME_MAX} characters`)
  .regex(/^[a-z0-9_.]+$/i, 'Username may only contain letters, numbers, underscores, and periods')
  .refine((value) => !RESERVED_USERNAMES.includes(value.toLowerCase()), {
    message: 'This username is reserved',
  });

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.DISPLAY_NAME_MIN, 'Display name is required')
  .max(
    LIMITS.DISPLAY_NAME_MAX,
    `Display name must be at most ${LIMITS.DISPLAY_NAME_MAX} characters`,
  );

/**
 * Password strength (Requirement Scope §6.1): length plus basic complexity.
 * The UI derives its live strength meter from `passwordStrength`.
 */
export const passwordSchema = z
  .string()
  .min(LIMITS.PASSWORD_MIN, `Password must be at least ${LIMITS.PASSWORD_MIN} characters`)
  .max(LIMITS.PASSWORD_MAX, `Password must be at most ${LIMITS.PASSWORD_MAX} characters`)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), {
    message: 'Password must contain at least one letter and one number',
  });

/**
 * Recovery email is optional, but when provided must be a gmail.com address
 * (Requirement Scope §6.1 — all other domains rejected at signup).
 */
export const recoveryEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .refine((value) => value.endsWith('@gmail.com'), {
    message: 'Only gmail.com addresses are accepted',
  });

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong';

/**
 * Heuristic score for the signup strength meter. Pure so the API and the UI
 * meter can never disagree.
 */
export function passwordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= LIMITS.PASSWORD_MIN) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;
  if (score <= 1) return 'weak';
  if (score === 2) return 'fair';
  if (score <= 4) return 'good';
  return 'strong';
}
