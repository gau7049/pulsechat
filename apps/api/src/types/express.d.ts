import type { AccessTokenClaims } from '../services/token.service.js';

/** Claims attached by the requireAuth middleware. */
declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export {};
