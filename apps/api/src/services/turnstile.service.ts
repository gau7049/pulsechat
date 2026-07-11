import { env } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Cloudflare Turnstile server-side verification (Technical Spec §7).
 * Dev fallback: with no TURNSTILE_SECRET configured, the check is skipped and
 * logged, so signup/login work before the account exists.
 */
export async function assertHuman(token: string | undefined, ip?: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) {
    logger.warn({ event: 'turnstile.skipped' }, 'TURNSTILE_SECRET unset — CAPTCHA check skipped');
    return;
  }
  if (!token) {
    throw new AppError('VALIDATION_FAILED', 'CAPTCHA verification is required', {
      turnstileToken: ['Complete the CAPTCHA challenge'],
    });
  }

  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (ip) body.set('remoteip', ip);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const result = (await response.json()) as { success: boolean; 'error-codes'?: string[] };

  if (!result.success) {
    logger.warn(
      { event: 'turnstile.failed', errors: result['error-codes'] },
      'Turnstile verification failed',
    );
    throw new AppError('VALIDATION_FAILED', 'CAPTCHA verification failed — try again', {
      turnstileToken: ['CAPTCHA verification failed'],
    });
  }
}
