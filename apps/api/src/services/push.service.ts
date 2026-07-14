import webpush, { WebPushError } from 'web-push';
import type { PushSubscribeBody } from '@pulsechat/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';

/**
 * Web Push delivery (Technical Spec §12). Ships safe without the VAPID
 * manual-setup step — every call here becomes a no-op until both keys are
 * present, the same pattern M5 used for TURN/coturn.
 */

let configured = false;

export function configureWebPush(): void {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      'mailto:noreply@pulsechat.app',
      env.VAPID_PUBLIC_KEY,
      env.VAPID_PRIVATE_KEY,
    );
    configured = true;
    logger.info({ event: 'push.configured' }, 'web push configured');
  } else {
    logger.warn(
      { event: 'push.unconfigured' },
      'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY unset — push notifications are a no-op until set',
    );
  }
}

export async function subscribe(userId: string, body: PushSubscribeBody): Promise<void> {
  // §24.9 — distinguishes installed/standalone usage from an open browser tab.
  const installedPwa = body.installedPwa ?? false;
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      endpoint: body.endpoint,
      userId,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      installedPwa,
    },
    update: { userId, p256dh: body.keys.p256dh, auth: body.keys.auth, installedPwa },
  });
}

export async function unsubscribe(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export interface PushPayload {
  title: string;
  body: string;
  /** Collapses repeated notifications from the same source in the OS tray. */
  tag?: string;
  /** Where notificationclick should focus/open the app. */
  url?: string;
}

/** Best-effort — never throws; a failed push must never fail the caller's action. */
export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  if (!configured) return;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
      } catch (error) {
        if (
          error instanceof WebPushError &&
          (error.statusCode === 404 || error.statusCode === 410)
        ) {
          // Subscription is dead (browser unsubscribed, cleared storage, etc.) — self-clean.
          await prisma.pushSubscription
            .delete({ where: { endpoint: sub.endpoint } })
            .catch(() => {});
          return;
        }
        logger.error({ event: 'push.send_failed', userId, err: error }, 'push send failed');
      }
    }),
  );
}
