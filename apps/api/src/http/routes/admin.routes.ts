import { Router } from 'express';
import { adminTimeseriesQuerySchema, type AdminTimeseriesQuery } from '@pulsechat/shared';
import * as adminAnalytics from '../../services/admin-analytics.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { validateQuery } from '../middleware/validate.js';

/**
 * Admin analytics dashboard (Technical Spec §13, Requirement Scope §18.1).
 * No separate admin SPA — this is just a JWT-role-gated route group, per
 * Technical Spec §1.
 */
export const adminRouter: Router = Router();

adminRouter.use('/admin/analytics', requireAuth, requireAdmin, apiLimiter);

adminRouter.get('/admin/analytics/summary', async (_req, res) => {
  res.json(await adminAnalytics.getSummary());
});

adminRouter.get(
  '/admin/analytics/timeseries',
  validateQuery(adminTimeseriesQuerySchema),
  async (req, res) => {
    const { metric, range } = req.validatedQuery as AdminTimeseriesQuery;
    res.json({ items: await adminAnalytics.getTimeseries(metric, range) });
  },
);
