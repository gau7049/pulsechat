/**
 * The single JSON error shape every API response uses (Build Instructions §6).
 * Produced only by the API's central error middleware; consumed by the web client.
 */
export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. "VALIDATION_FAILED". */
    code: ErrorCode;
    /** Human-readable summary, safe to surface in the UI. */
    message: string;
    /** Field-level issues for VALIDATION_FAILED (zod flatten output). */
    details?: Record<string, string[]>;
    /** Correlation id echoed from the request, for tracing. */
    requestId?: string;
  };
}

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
  /** §6.2 — a sensitive action needs a fresh password re-confirmation first. */
  'STEP_UP_REQUIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  STEP_UP_REQUIRED: 403,
};
