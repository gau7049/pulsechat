import { Router } from 'express';
import { getOrCreateInvite, lookupInvite } from '../../services/invite.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param } from '../middleware/validate.js';

/** Personal invite links (Requirement Scope §10.3, Technical Spec §8). */
export const invitesRouter: Router = Router();

/** Returns the caller's shareable code, creating it on first use. */
invitesRouter.post('/invites', requireAuth, apiLimiter, async (req, res) => {
  res.json(await getOrCreateInvite(req.auth!.sub));
});

/** Public: the invite landing page resolves who invited the visitor. */
invitesRouter.get('/invites/:code', apiLimiter, async (req, res) => {
  res.json(await lookupInvite(param(req, 'code')));
});
