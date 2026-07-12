import { Router } from 'express';
import { postsQuerySchema, type PaginationQuery } from '@pulsechat/shared';
import { getHashtagPage } from '../../services/post.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateQuery } from '../middleware/validate.js';

/** §13.2 hashtag pages — ranked posts from public authors only. */
export const hashtagsRouter: Router = Router();

hashtagsRouter.use('/hashtags', requireAuth, apiLimiter);

hashtagsRouter.get('/hashtags/:tag', validateQuery(postsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await getHashtagPage(req.auth!.sub, param(req, 'tag'), query));
});
