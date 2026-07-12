import { Router } from 'express';
import {
  notificationsQuerySchema,
  pushSubscribeSchema,
  pushUnsubscribeQuerySchema,
  type NotificationsQuery,
  type PushSubscribeBody,
  type PushUnsubscribeQuery,
} from '@pulsechat/shared';
import * as notifications from '../../services/notification.service.js';
import * as push from '../../services/push.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateBody, validateQuery } from '../middleware/validate.js';

/** Notifications & Web Push (Technical Spec §12, Requirement Scope §17). */
export const notificationsRouter: Router = Router();

notificationsRouter.use(['/notifications', '/push'], requireAuth, apiLimiter);

notificationsRouter.get(
  '/notifications',
  validateQuery(notificationsQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery as NotificationsQuery;
    res.json(await notifications.listNotifications(req.auth!.sub, query));
  },
);

notificationsRouter.patch('/notifications/:id/read', async (req, res) => {
  await notifications.markRead(req.auth!.sub, param(req, 'id'));
  res.json({ ok: true });
});

/** §12 "marked read on view" — the bell dropdown calls this once on open. */
notificationsRouter.post('/notifications/read-all', async (req, res) => {
  await notifications.markAllRead(req.auth!.sub);
  res.json({ ok: true });
});

notificationsRouter.post('/push/subscribe', validateBody(pushSubscribeSchema), async (req, res) => {
  await push.subscribe(req.auth!.sub, req.body as PushSubscribeBody);
  res.status(201).json({ ok: true });
});

notificationsRouter.delete(
  '/push/subscribe',
  validateQuery(pushUnsubscribeQuerySchema),
  async (req, res) => {
    const { endpoint } = req.validatedQuery as PushUnsubscribeQuery;
    await push.unsubscribe(endpoint);
    res.json({ ok: true });
  },
);
