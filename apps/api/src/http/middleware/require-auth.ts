import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import { verifyAccessToken } from '../../services/token.service.js';

/** Bearer-token guard: verifies the JWT and attaches claims as req.auth. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new AppError('UNAUTHORIZED', 'Sign in to continue'));
    return;
  }
  try {
    req.auth = await verifyAccessToken(header.slice('Bearer '.length));
    next();
  } catch (error) {
    next(error);
  }
}

/** Admin-only guard, layered on top of requireAuth. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'admin') {
    next(new AppError('FORBIDDEN', 'Administrator access required'));
    return;
  }
  next();
}
