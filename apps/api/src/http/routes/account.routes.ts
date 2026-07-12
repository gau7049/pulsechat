import { Router, type Request } from 'express';
import {
  accountActionSchema,
  restoreConfirmSchema,
  restoreRequestSchema,
  type AccountActionBody,
  type RestoreConfirmBody,
  type RestoreRequestBody,
} from '@pulsechat/shared';
import * as accountService from '../../services/account.service.js';
import type { RequestContext } from '../../services/auth.service.js';
import { apiLimiter, authLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateBody } from '../middleware/validate.js';

/** Account lifecycle (Requirement Scope §16): deactivate/delete/restore/export. */
export const accountRouter: Router = Router();

function requestContext(req: Request): RequestContext {
  return { ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] ?? 'unknown' };
}

accountRouter.post(
  '/account/deactivate',
  requireAuth,
  apiLimiter,
  validateBody(accountActionSchema),
  async (req, res) => {
    const { currentPassword } = req.body as AccountActionBody;
    await accountService.deactivate(req.auth!.sub, currentPassword, requestContext(req));
    res.json({ ok: true });
  },
);

accountRouter.post(
  '/account/delete',
  requireAuth,
  apiLimiter,
  validateBody(accountActionSchema),
  async (req, res) => {
    const { currentPassword } = req.body as AccountActionBody;
    await accountService.deleteAccount(req.auth!.sub, currentPassword, requestContext(req));
    res.json({ ok: true });
  },
);

accountRouter.get('/account/export', requireAuth, apiLimiter, async (req, res) => {
  const data = await accountService.exportData(req.auth!.sub);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="pulsechat-export-${req.auth!.sub}.json"`,
  );
  res.json(data);
});

// Restoration is a guest-accessible flow — the account is deleted, so the
// requester has no session yet.
accountRouter.post(
  '/account/restore/request',
  authLimiter,
  validateBody(restoreRequestSchema),
  async (req, res) => {
    const { username } = req.body as RestoreRequestBody;
    await accountService.requestRestore(username);
    res.status(202).json({ sent: true });
  },
);

accountRouter.post(
  '/account/restore/confirm',
  authLimiter,
  validateBody(restoreConfirmSchema),
  async (req, res) => {
    const { token } = req.body as RestoreConfirmBody;
    await accountService.confirmRestore(token, requestContext(req));
    res.json({ restored: true });
  },
);
