import { Router } from 'express';
import {
  addMemberSchema,
  createConversationSchema,
  messagesQuerySchema,
  type AddMemberBody,
  type CreateConversationBody,
  type PaginationQuery,
} from '@pulsechat/shared';
import * as chatService from '../../services/chat.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateBody, validateQuery } from '../middleware/validate.js';

/** Conversations & message history (Technical Spec §8: Conversations group). */
export const chatRouter: Router = Router();

chatRouter.use(['/conversations', '/messages'], requireAuth, apiLimiter);

chatRouter.get('/conversations', async (req, res) => {
  res.json({ items: await chatService.listConversations(req.auth!.sub) });
});

/** Returns 200 with the existing conversation for a duplicate direct pair. */
chatRouter.post('/conversations', validateBody(createConversationSchema), async (req, res) => {
  const body = req.body as CreateConversationBody;
  const { conversation, existing } = await chatService.createConversation(req.auth!.sub, body);
  res.status(existing ? 200 : 201).json({ conversation });
});

chatRouter.get(
  '/conversations/:id/messages',
  validateQuery(messagesQuerySchema),
  async (req, res) => {
    const query = req.validatedQuery as PaginationQuery;
    res.json(await chatService.getMessages(req.auth!.sub, param(req, 'id'), query));
  },
);

chatRouter.post('/conversations/:id/members', validateBody(addMemberSchema), async (req, res) => {
  const body = req.body as AddMemberBody;
  await chatService.addMember(req.auth!.sub, param(req, 'id'), body);
  res.status(201).json({ ok: true });
});

chatRouter.delete('/conversations/:id/members/:userId', async (req, res) => {
  await chatService.removeMember(req.auth!.sub, param(req, 'id'), param(req, 'userId'));
  res.json({ ok: true });
});

/** §14.2 per-member delivery breakdown — sender only. */
chatRouter.get('/messages/:id/statuses', async (req, res) => {
  res.json({ items: await chatService.statusBreakdown(req.auth!.sub, param(req, 'id')) });
});
