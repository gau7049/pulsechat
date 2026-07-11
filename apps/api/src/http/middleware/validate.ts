import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../errors.js';

/**
 * Request-body validation against a shared zod schema (Build Instructions §6:
 * reject early with the shared error shape). The parsed value replaces
 * req.body so handlers only ever see validated data.
 */
export function validateBody<TSchema extends ZodTypeAny>(schema: TSchema): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(
          'VALIDATION_FAILED',
          'Request validation failed',
          result.error.flatten().fieldErrors as Record<string, string[]>,
        ),
      );
      return;
    }
    req.body = result.data as z.infer<TSchema>;
    next();
  };
}
