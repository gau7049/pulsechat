import { Router } from 'express';
import { z } from 'zod';
import * as presence from '../../services/presence.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateQuery } from '../middleware/validate.js';

const activeCountQuerySchema = z.object({ scope: z.enum(['all', 'friends']).default('all') });
type ActiveCountQuery = z.infer<typeof activeCountQuerySchema>;

/** §12.2 active-users indicator. */
export const presenceRouter: Router = Router();

presenceRouter.use('/presence', requireAuth, apiLimiter);

presenceRouter.get(
  '/presence/active-count',
  validateQuery(activeCountQuerySchema),
  async (req, res) => {
    const { scope } = req.validatedQuery as ActiveCountQuery;
    res.json({ count: await presence.activeCount(req.auth!.sub, scope) });
  },
);
