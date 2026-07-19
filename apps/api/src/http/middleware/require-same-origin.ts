import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { AppError } from '../errors.js';

/**
 * CSRF defense-in-depth (M12): the refresh/logout cookie is already
 * `sameSite: 'strict'`, which browsers honor for cross-site requests — this
 * is a second, independent layer for the endpoints that trust that cookie,
 * rejecting any request whose `Origin` (or, lacking that, `Referer`) header
 * doesn't match the configured web app origin. A same-site browser request
 * always carries one of these headers; only a same-site *navigation* omits
 * both, and neither of these endpoints is ever reached by navigation.
 */
export function requireSameOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.headers.origin ?? req.headers.referer;
  if (origin && !origin.startsWith(env.APP_ORIGIN)) {
    next(new AppError('FORBIDDEN', 'Cross-origin request rejected'));
    return;
  }
  next();
}
