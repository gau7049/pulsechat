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
  /** Plaintext message cap (chars); ciphertext cap is derived from it. */
  MESSAGE_TEXT_MAX: 4000,
  /** base64(AES-GCM(4000-char UTF-8 text)) stays well under this. */
  MESSAGE_CIPHERTEXT_MAX_CHARS: 24000,
  /** base64(crypto_box_seal(32-byte key)) is 108 chars; headroom for variants. */
  WRAPPED_KEY_MAX_CHARS: 256,
  /** Other members besides the creator. */
  GROUP_MEMBERS_MAX: 49,
  /** How often the API sweeps expired statuses / abandoned live sessions. */
  STATUS_EXPIRY_SWEEP_INTERVAL_MS: 15 * 60 * 1000,
  /** Lifetime of a short-lived coturn REST-API credential (Technical Spec §11). */
  TURN_CREDENTIAL_TTL_SECONDS: 60 * 60,
  /** Recent-post window ranked in-memory for hashtag pages / explore (§13.2). */
  FEED_RANKING_WINDOW: 300,
  /** §24.3 — how often the API re-fetches TMDB/Deezer trending content. */
  TRENDING_REFRESH_INTERVAL_MS: 6 * 60 * 60 * 1000,
  /** §24.3 — trending rows kept per source, both well under either API's free-tier page size. */
  TRENDING_ITEMS_PER_SOURCE: 20,
  /** §6.2 remember-me: refresh-cookie/token lifetime when rememberMe is true. */
  REMEMBER_ME_REFRESH_DAYS: 30,
  /** §6.2 remember-me: server-side cap when rememberMe is false — the cookie
   *  itself is already browser-session-only; this is defense in depth. */
  SESSION_ONLY_REFRESH_HOURS: 24,
  /** §6.2 step-up re-auth: how long a password re-confirmation stays valid. */
  STEP_UP_TTL_MINUTES: 10,
  /** §24.15 — comments kept in memory per active live broadcast for late joiners. */
  LIVE_COMMENT_HISTORY_SIZE: 30,
  LIVE_COMMENT_MAX_CHARS: 300,
  /** §24.14 — how often the API checks for friendship anniversaries. */
  ANNIVERSARY_SWEEP_INTERVAL_MS: 24 * 60 * 60 * 1000,
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
