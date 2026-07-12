import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

/**
 * Raw usage-event stream feeding the admin dashboard (Technical Spec §13,
 * Requirement Scope §18.1) — deliberately never touches chat content.
 * Best-effort, same shape as `notify()`: a tracking failure must never fail
 * the action that triggered it.
 */
export async function track(eventType: string, userId?: string): Promise<void> {
  try {
    await prisma.analyticsEvent.create({ data: { eventType, userId } });
  } catch (error) {
    logger.error(
      { event: 'analytics.track_failed', eventType, userId, err: error },
      'track failed',
    );
  }
}
