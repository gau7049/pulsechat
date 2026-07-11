import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@pulsechat/shared';
import { AppError } from '../errors.js';

/** Errors thrown by express/body-parser carry a 4xx `status` property. */
function isClientHttpError(err: unknown): err is Error & { status: number } {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number' &&
    (err as { status: number }).status >= 400 &&
    (err as { status: number }).status < 500
  );
}

/**
 * Central error middleware (Build Instructions §6): every failure funnels here
 * and leaves as the one shared JSON error shape. Nothing else in the API is
 * allowed to write an error response.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.getHeader('X-Request-Id')?.toString();

  let body: ApiErrorBody;
  let status: number;

  if (err instanceof AppError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details, requestId } };
  } else if (err instanceof ZodError) {
    // A zod error reaching here means a validation middleware was bypassed —
    // still translate it, but as a client error, never a 500.
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: err.flatten().fieldErrors as Record<string, string[]>,
        requestId,
      },
    };
  } else if (isClientHttpError(err)) {
    // body-parser / http-errors failures (malformed JSON, oversized payload):
    // client mistakes, reported as such — never as a 500.
    status = err.status;
    body = {
      error: {
        code: status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
        message: status === 413 ? 'Request body too large' : 'Malformed request body',
        requestId,
      },
    };
  } else {
    status = 500;
    // Never leak internals (stack, driver messages) to the client.
    body = { error: { code: 'INTERNAL', message: 'Something went wrong', requestId } };
  }

  if (status >= 500) {
    req.log?.error({ err, requestId }, 'unhandled error');
  }

  res.status(status).json(body);
}
