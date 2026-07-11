/** Product-wide limits fixed by the Requirement Scope; single source for both apps. */
export const LIMITS = {
  /** Requirement Scope §14.8 — every uploaded file is capped at 10 MB. */
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  /** Requirement Scope §20 — cap on outgoing pending friend requests per user. */
  MAX_PENDING_FRIEND_REQUESTS: 20,
  /** Requirement Scope §11 — status lifetime. */
  STATUS_TTL_HOURS: 24,
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 50,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  /** Requirement Scope §6.1 — minimum age at signup. */
  MIN_AGE_YEARS: 13,
  /** Default page size for cursor-paginated list endpoints. */
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 50,
} as const;

/**
 * Requirement Scope §6.1 — usernames that can never be registered.
 * Compared case-insensitively against the full username.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  'admin',
  'administrator',
  'root',
  'support',
  'help',
  'moderator',
  'mod',
  'system',
  'pulsechat',
  'official',
  'security',
  'staff',
  'api',
  'null',
  'undefined',
  'me',
  'settings',
];
