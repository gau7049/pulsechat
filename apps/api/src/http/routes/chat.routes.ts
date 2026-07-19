import { Router } from 'express';
import { z } from 'zod';
import {
  addMemberSchema,
  conversationSettingsSchema,
  createConversationSchema,
  deleteMessageQuerySchema,
  editMessageSchema,
  messagesQuerySchema,
  paginationQuerySchema,
  reactionSchema,
  transferAdminSchema,
  updateGroupPhotoSchema,
  type AddMemberBody,
  type ConversationSettingsBody,
  type CreateConversationBody,
  type DeleteMessageQuery,
  type EditMessageBody,
  type PaginationQuery,
  type ReactionBody,
  type TransferAdminBody,
  type UpdateGroupPhotoBody,
} from '@pulsechat/shared';
import * as chatService from '../../services/chat.service.js';
import { signAttachmentUpload, signGroupPhotoUpload } from '../../services/cloudinary.service.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { param, validateBody, validateQuery } from '../middleware/validate.js';

/** Conversations & message actions (Technical Spec §8). */
export const chatRouter: Router = Router();

chatRouter.use(['/conversations', '/messages', '/uploads'], requireAuth, apiLimiter);

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

/** §14.11 pin/mute/archive — the caller's own member flags. */
chatRouter.patch(
  '/conversations/:id',
  validateBody(conversationSettingsSchema),
  async (req, res) => {
    const body = req.body as ConversationSettingsBody;
    await chatService.updateConversationSettings(req.auth!.sub, param(req, 'id'), body);
    res.json({ ok: true });
  },
);

/** Group photo upload token — creator-or-admin gated before Cloudinary is ever signed. */
chatRouter.post('/conversations/:id/photo-upload-token', async (req, res) => {
  const conversationId = param(req, 'id');
  await chatService.assertGroupPhotoPermission(req.auth!.sub, conversationId);
  res.json(signGroupPhotoUpload(conversationId));
});

/** Persist the group photo once uploaded. */
chatRouter.patch(
  '/conversations/:id/photo',
  validateBody(updateGroupPhotoSchema),
  async (req, res) => {
    const body = req.body as UpdateGroupPhotoBody;
    await chatService.updateGroupPhoto(req.auth!.sub, param(req, 'id'), body.photoUrl);
    res.json({ ok: true });
  },
);

/** Transfer the admin role to another member — current admin only. */
chatRouter.post('/conversations/:id/admin', validateBody(transferAdminSchema), async (req, res) => {
  const body = req.body as TransferAdminBody;
  await chatService.transferAdmin(req.auth!.sub, param(req, 'id'), body.toUserId);
  res.json({ ok: true });
});

/** §14.6 starred messages view — registered before /messages/:id routes. */
chatRouter.get('/messages/starred', validateQuery(paginationQuerySchema), async (req, res) => {
  const query = req.validatedQuery as PaginationQuery;
  res.json(await chatService.listStarredMessages(req.auth!.sub, query));
});

/** §14.2 per-member delivery breakdown — sender only. */
chatRouter.get('/messages/:id/statuses', async (req, res) => {
  res.json({ items: await chatService.statusBreakdown(req.auth!.sub, param(req, 'id')) });
});

/** §14.3 edit — body carries the re-encrypted content. */
chatRouter.patch('/messages/:id', validateBody(editMessageSchema), async (req, res) => {
  const body = req.body as EditMessageBody;
  res.json({ message: await chatService.editMessage(req.auth!.sub, param(req, 'id'), body) });
});

/** §14.3 delete for me / for everyone. */
chatRouter.delete('/messages/:id', validateQuery(deleteMessageQuerySchema), async (req, res) => {
  const { scope } = req.validatedQuery as DeleteMessageQuery;
  await chatService.deleteMessage(req.auth!.sub, param(req, 'id'), scope);
  res.json({ ok: true });
});

/** §14.4 reaction toggle. */
chatRouter.post('/messages/:id/reactions', validateBody(reactionSchema), async (req, res) => {
  const { emoji } = req.body as ReactionBody;
  res.json(await chatService.reactToMessage(req.auth!.sub, param(req, 'id'), emoji));
});

/** §14.6 star toggle — private to the caller. */
chatRouter.post('/messages/:id/star', async (req, res) => {
  res.json(await chatService.starMessage(req.auth!.sub, param(req, 'id')));
});

const attachmentTokenSchema = z.object({
  resourceType: z.enum(['image', 'video', 'raw']),
});

/** §14.8 signed direct-upload token; bytes never touch this server. */
chatRouter.post('/uploads/attachment-token', validateBody(attachmentTokenSchema), (req, res) => {
  const { resourceType } = req.body as z.infer<typeof attachmentTokenSchema>;
  res.json(signAttachmentUpload(req.auth!.sub, resourceType));
});
