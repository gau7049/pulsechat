import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';

/** Unmatched routes fall through to the central error handler as 404s. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} does not exist`));
}
