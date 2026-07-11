import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

/**
 * Owner-visible security audit log (Requirement Scope §20): sensitive account
 * events, viewable read-only by the account owner in Settings → Security.
 */
export type AuditEvent =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'register'
  | 'password_changed'
  | 'password_reset'
  | 'email_verified'
  | 'magic_link_login'
  | 'otp_enabled'
  | 'otp_disabled'
  | 'new_device_pending'
  | 'new_device_confirmed'
  | 'session_revoked';

export async function recordAudit(
  userId: string,
  eventType: AuditEvent,
  context: { ip?: string; device?: string },
): Promise<void> {
  try {
    await prisma.auditLogEntry.create({
      data: { userId, eventType, ip: context.ip ?? null, device: context.device ?? null },
    });
  } catch (error) {
    // The audit trail must never take down the operation it documents.
    logger.error({ event: 'audit.write_failed', eventType, err: error }, 'audit write failed');
  }
  logger.info({ event: `audit.${eventType}`, userId }, 'security event');
}
