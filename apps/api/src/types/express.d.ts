import type { AccessTokenClaims } from '../services/token.service.js';

/** Claims attached by the requireAuth middleware. */
declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
      /** Parsed query set by validateQuery (req.query is read-only in Express 5). */
      validatedQuery?: unknown;
    }
  }
}

export {};
