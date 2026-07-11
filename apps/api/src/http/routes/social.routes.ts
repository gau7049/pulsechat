import { Router } from 'express';
import {
  blockUserSchema,
  friendRequestListQuerySchema,
  paginationQuerySchema,
  respondFriendRequestSchema,
  sendFriendRequestSchema,
  userSearchQuerySchema,
  type BlockUserBody,
  type FriendRequestListQuery,
  type PaginationQuery,
  type RespondFriendRequestBody,
  type SendFriendRequestBody,
  type UserSearchQuery,
} from '@pulsechat/shared';
import * as socialService from '../../services/social.service.js';
import { apiLimiter, friendRequestLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateBody, validateQuery } from '../middleware/validate.js';

/** Social graph endpoints (Technical Spec §8: Search & Friends group). */
export const socialRouter: Router = Router();

socialRouter.use(['/search', '/friend-requests', '/friends', '/blocks'], requireAuth, apiLimiter);

// ── Search (§9) ──────────────────────────────────────────────────────────────

socialRouter.get('/search/users', validateQuery(userSearchQuerySchema), async (req, res) => {
  const query = req.validatedQuery as UserSearchQuery;
  res.json(await socialService.searchUsers(req.auth!.sub, query));
});

// ── Friend requests (§10) ────────────────────────────────────────────────────

socialRouter.post(
  '/friend-requests',
  friendRequestLimiter,
  validateBody(sendFriendRequestSchema),
  async (req, res) => {
    const { toUserId } = req.body as SendFriendRequestBody;
    const request = await socialService.sendFriendRequest(req.auth!.sub, toUserId);
    res.status(201).json(request);
  },
);

socialRouter.get(
  '/friend-requests',
  validateQuery(friendRequestListQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery as FriendRequestListQuery;
    res.json(await socialService.listRequests(req.auth!.sub, query.direction, query));
  },
);

socialRouter.patch(
  '/friend-requests/:id',
  validateBody(respondFriendRequestSchema),
  async (req, res) => {
    const { action } = req.body as RespondFriendRequestBody;
    await socialService.respondToRequest(req.auth!.sub, param(req, 'id'), action);
    res.json({ ok: true });
  },
);

// ── Friends ──────────────────────────────────────────────────────────────────

socialRouter.get('/friends', validateQuery(paginationQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await socialService.listFriends(req.auth!.sub, query));
});

/** "People you may know" — mutual-friend suggestions (§10.1). */
socialRouter.get('/friends/suggestions', async (req, res) => {
  res.json({ items: await socialService.suggestions(req.auth!.sub) });
});

socialRouter.delete('/friends/:userId', async (req, res) => {
  await socialService.removeFriend(req.auth!.sub, req.params.userId);
  res.json({ ok: true });
});

// ── Blocks (§10.2) ───────────────────────────────────────────────────────────

socialRouter.get('/blocks', async (req, res) => {
  res.json({ items: await socialService.listBlocked(req.auth!.sub) });
});

socialRouter.post('/blocks', validateBody(blockUserSchema), async (req, res) => {
  const { userId } = req.body as BlockUserBody;
  await socialService.blockUser(req.auth!.sub, userId);
  res.status(201).json({ ok: true });
});

socialRouter.delete('/blocks/:userId', async (req, res) => {
  await socialService.unblockUser(req.auth!.sub, req.params.userId);
  res.json({ ok: true });
});
