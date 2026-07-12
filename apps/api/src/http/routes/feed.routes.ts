import { Router } from 'express';
import { postsQuerySchema, type PaginationQuery } from '@pulsechat/shared';
import { getExploreFeed } from '../../services/post.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateQuery } from '../middleware/validate.js';

/** §13.7 explore/discover feed — ranked public posts. */
export const feedRouter: Router = Router();

feedRouter.use('/feed', requireAuth, apiLimiter);

feedRouter.get('/feed/explore', validateQuery(postsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await getExploreFeed(req.auth!.sub, query));
});
