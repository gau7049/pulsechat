import { Router } from 'express';
import * as turnService from '../../services/turn.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';

/** §11 — ICE server list for WebRTC calls/live; STUN always, TURN when provisioned. */
export const rtcRouter: Router = Router();

rtcRouter.use('/rtc', requireAuth, apiLimiter);

rtcRouter.get('/rtc/ice-servers', (req, res) => {
  res.json(turnService.getIceServers(req.auth!.sub));
});
