import { ERROR_STATUS, type ErrorCode } from '@pulsechat/shared';

/**
 * The only error type route/service code should throw for expected failures.
 * The central error middleware maps it to the shared ApiErrorBody shape;
 * anything else becomes an opaque 500 INTERNAL.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;

  constructor(code: ErrorCode, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}
