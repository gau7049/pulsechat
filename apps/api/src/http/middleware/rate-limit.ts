import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@pulsechat/shared';
import { env } from '../../config/env.js';

/**
 * Per-endpoint-class rate limiting (Requirement Scope §20, Technical Spec §7),
 * backed by in-process stores. Exposes X-RateLimit-* headers per §21.
 */

function limitHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests — slow down and try again shortly',
      requestId: res.getHeader('X-Request-Id')?.toString(),
    },
  };
  res.status(429).json(body);
}

function makeLimiter(windowMs: number, limit: number, keyGenerator?: (req: Request) => string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: false,
    legacyHeaders: true, // X-RateLimit-Limit / -Remaining / -Reset
    handler: limitHandler,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Integration tests hammer endpoints from one IP; brute-force backoff
    // still covers the login path there.
    skip: () => env.NODE_ENV === 'test',
  });
}

/**
 * M12: per-IP alone lets a distributed attacker on one compromised account
 * spread requests across many IPs to dodge the limit. Every route this is
 * mounted on already runs `requireAuth` first, so `req.auth.sub` is always
 * present — key by that instead of IP, falling back to IP only for the one
 * unauthenticated route it happens to guard (the public invite-code lookup).
 */
export function byUserOrIp(req: Request): string {
  return req.auth?.sub ?? ipKeyGenerator(req.ip ?? 'unknown');
}

/** Credential-touching endpoints: strict. */
export const authLimiter = makeLimiter(15 * 60 * 1000, 30);

/** Endpoints that trigger an outbound email: very strict. */
export const emailLimiter = makeLimiter(15 * 60 * 1000, 8);

/** General authenticated API traffic — per-user, not per-IP (see `byUserOrIp`). */
export const apiLimiter = makeLimiter(60 * 1000, 300, byUserOrIp);

/** Friend-request sends — its own endpoint class per Technical Spec §7. */
export const friendRequestLimiter = makeLimiter(15 * 60 * 1000, 30);

/** Report submissions — the generic apiLimiter is far too generous for an abuse-report vector. */
export const reportLimiter = makeLimiter(15 * 60 * 1000, 10);
