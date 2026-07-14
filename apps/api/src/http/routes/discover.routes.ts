import { Router } from 'express';
import { discoverQuerySchema, type DiscoverQuery } from '@pulsechat/shared';
import { listTrendingMovies, listTrendingSongs } from '../../services/trending.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateQuery } from '../middleware/validate.js';

/** §24.3 trending movies & songs — served straight from the cache tables. */
export const discoverRouter: Router = Router();

discoverRouter.use('/discover', requireAuth, apiLimiter);

discoverRouter.get('/discover/movies', validateQuery(discoverQuerySchema), async (req, res) => {
  const query = req.validatedQuery as DiscoverQuery;
  res.json(await listTrendingMovies(query));
});

discoverRouter.get('/discover/songs', validateQuery(discoverQuerySchema), async (req, res) => {
  const query = req.validatedQuery as DiscoverQuery;
  res.json(await listTrendingSongs(query));
});
