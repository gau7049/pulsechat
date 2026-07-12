import { Router } from 'express';
import {
  adminReportsQuerySchema,
  adminSetUserStatusSchema,
  createReportSchema,
  reportActionSchema,
  type AdminReportsQuery,
  type AdminSetUserStatusBody,
  type CreateReportBody,
  type ReportActionBody,
} from '@pulsechat/shared';
import * as reportService from '../../services/report.service.js';
import { apiLimiter, reportLimiter } from '../middleware/rate-limit.js';
import { requireAdmin, requireAuth } from '../middleware/require-auth.js';
import { param, validateBody, validateQuery } from '../middleware/validate.js';

/** Reports & admin moderation queue (Requirement Scope §18, Technical Spec §13). */
export const reportsRouter: Router = Router();

reportsRouter.post(
  '/reports',
  requireAuth,
  reportLimiter,
  validateBody(createReportSchema),
  async (req, res) => {
    await reportService.createReport(req.auth!.sub, req.body as CreateReportBody);
    res.status(201).json({ ok: true });
  },
);

reportsRouter.use(['/admin/reports', '/admin/users'], requireAuth, requireAdmin, apiLimiter);

reportsRouter.get('/admin/reports', validateQuery(adminReportsQuerySchema), async (req, res) => {
  const query = req.validatedQuery as AdminReportsQuery;
  res.json(await reportService.listReports(query));
});

reportsRouter.patch('/admin/reports/:id', validateBody(reportActionSchema), async (req, res) => {
  const { action } = req.body as ReportActionBody;
  await reportService.actionReport(param(req, 'id'), action);
  res.json({ ok: true });
});

reportsRouter.patch(
  '/admin/users/:id/status',
  validateBody(adminSetUserStatusSchema),
  async (req, res) => {
    const { status } = req.body as AdminSetUserStatusBody;
    await reportService.setUserStatus(param(req, 'id'), status);
    res.json({ ok: true });
  },
);
