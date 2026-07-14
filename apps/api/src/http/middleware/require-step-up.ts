import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import { verifyStepUpToken } from '../../services/token.service.js';

/**
 * §6.2 step-up re-auth guard: layered on top of `requireAuth`. Verifies an
 * `x-step-up-token` header (issued by `POST /auth/step-up`) is present, not
 * expired, and bound to this exact user + device — a token from another
 * session or a stale one is rejected the same as a missing one.
 */
export async function requireStepUp(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers['x-step-up-token'];
  if (typeof header !== 'string' || header.length === 0) {
    next(new AppError('STEP_UP_REQUIRED', 'This action requires re-entering your password'));
    return;
  }
  try {
    const claims = await verifyStepUpToken(header);
    if (claims.userId !== req.auth!.sub || claims.deviceId !== req.auth!.deviceId) {
      throw new AppError('STEP_UP_REQUIRED', 'This action requires re-entering your password');
    }
    next();
  } catch (error) {
    next(error);
  }
}
