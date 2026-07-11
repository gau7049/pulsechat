import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Structured application logger (Build Instructions §6): every significant
 * operation logs level + event + correlation id so failures are traceable
 * without a debugger. Request-scoped children are created by pino-http with
 * the request id attached.
 */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
      : undefined,
});
