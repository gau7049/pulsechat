import { Router } from 'express';
import {
  createStatusSchema,
  reactToStatusSchema,
  respondToPollSchema,
  startLiveSchema,
  type CreateStatusBody,
  type ReactToStatusBody,
  type RespondToPollBody,
  type StartLiveBody,
} from '@pulsechat/shared';
import * as liveService from '../../services/live.service.js';
import * as statusService from '../../services/status.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateBody } from '../middleware/validate.js';

/** Status & live (Technical Spec §8 "Status & Live" endpoint group). */
export const statusRouter: Router = Router();

statusRouter.use(['/statuses', '/live'], requireAuth, apiLimiter);

/** §12.1 rail — registered before /statuses/:id-shaped routes. */
statusRouter.get('/statuses/feed', async (req, res) => {
  res.json({ items: await statusService.getFeed(req.auth!.sub) });
});

statusRouter.post('/statuses', validateBody(createStatusSchema), async (req, res) => {
  const body = req.body as CreateStatusBody;
  res.status(201).json({ status: await statusService.createStatus(req.auth!.sub, body) });
});

statusRouter.delete('/statuses/:id', async (req, res) => {
  await statusService.deleteStatus(req.auth!.sub, param(req, 'id'));
  res.json({ ok: true });
});

// ── Reactions (§24.10) ───────────────────────────────────────────────────────

statusRouter.post('/statuses/:id/react', validateBody(reactToStatusSchema), async (req, res) => {
  const body = req.body as ReactToStatusBody;
  res.json(await statusService.reactToStatus(req.auth!.sub, param(req, 'id'), body));
});

// ── Polls/questions (§24.13) ─────────────────────────────────────────────────

statusRouter.post(
  '/statuses/:id/poll/respond',
  validateBody(respondToPollSchema),
  async (req, res) => {
    const body = req.body as RespondToPollBody;
    await statusService.respondToPoll(req.auth!.sub, param(req, 'id'), body);
    res.json({ ok: true });
  },
);

statusRouter.get('/statuses/:id/poll/results', async (req, res) => {
  res.json(await statusService.getPollResults(req.auth!.sub, param(req, 'id')));
});

statusRouter.post('/live/start', validateBody(startLiveSchema), async (req, res) => {
  const body = req.body as StartLiveBody;
  res.status(201).json({ live: await liveService.startLive(req.auth!.sub, body) });
});

statusRouter.post('/live/end', async (req, res) => {
  await liveService.endLive(req.auth!.sub);
  res.json({ ok: true });
});

statusRouter.get('/live/active', async (req, res) => {
  res.json({ items: await statusService.listActiveLive(req.auth!.sub) });
});
