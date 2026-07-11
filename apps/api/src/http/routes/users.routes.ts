import { Router } from 'express';
import { z } from 'zod';
import {
  updatePrivacySchema,
  updateProfileSchema,
  type AuditLogEntryDto,
  type UpdatePrivacyBody,
  type UpdateProfileBody,
} from '@pulsechat/shared';
import { prisma } from '../../lib/prisma.js';
import * as users from '../../repositories/user.repository.js';
import { signUpload } from '../../services/cloudinary.service.js';
import { toMeDto } from '../../services/me.serializer.js';
import { AppError } from '../errors.js';
import { apiLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateBody } from '../middleware/validate.js';

export const usersRouter: Router = Router();

// Scoped to this router's paths only — a bare router.use() would swallow
// every request in the app, breaking 404 handling for unknown routes.
usersRouter.use(['/users', '/account'], requireAuth, apiLimiter);

usersRouter.get('/users/me', async (req, res) => {
  const user = await users.findById(req.auth!.sub);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  res.json({ user: toMeDto(user) });
});

usersRouter.patch('/users/me', validateBody(updateProfileSchema), async (req, res) => {
  const body = req.body as UpdateProfileBody;
  const updated = await users.updateUser(req.auth!.sub, {
    ...('displayName' in body ? { displayName: body.displayName } : {}),
    ...('bio' in body ? { bio: body.bio } : {}),
    ...('country' in body ? { country: body.country } : {}),
    ...('state' in body ? { state: body.state } : {}),
    ...('visibility' in body ? { visibility: body.visibility } : {}),
    ...('birthDate' in body ? { birthDate: body.birthDate ? new Date(body.birthDate) : null } : {}),
  });
  res.json({ user: toMeDto(updated) });
});

usersRouter.patch('/users/me/privacy', validateBody(updatePrivacySchema), async (req, res) => {
  const body = req.body as UpdatePrivacyBody;
  await users.updatePrivacy(req.auth!.sub, body);
  const user = await users.findById(req.auth!.sub);
  res.json({ user: toMeDto(user!) });
});

/** Client uploads the avatar bytes directly to Cloudinary with this token. */
usersRouter.post('/users/me/avatar-upload-token', (req, res) => {
  res.json(signUpload(req.auth!.sub, 'avatar'));
});

const setAvatarSchema = z.object({
  /** The secure_url Cloudinary returned after a successful direct upload. */
  avatarUrl: z.string().url().nullable(),
});

usersRouter.patch('/users/me/avatar', validateBody(setAvatarSchema), async (req, res) => {
  const { avatarUrl } = req.body as { avatarUrl: string | null };
  if (avatarUrl && !/^https:\/\/res\.cloudinary\.com\//.test(avatarUrl)) {
    throw new AppError('VALIDATION_FAILED', 'Avatar URL must be a Cloudinary delivery URL', {
      avatarUrl: ['Must be a Cloudinary delivery URL'],
    });
  }
  const updated = await users.updateUser(req.auth!.sub, { avatarUrl });
  res.json({ user: toMeDto(updated) });
});

/** Marks the §6.7 onboarding tour done — it never shows again. */
usersRouter.post('/users/me/onboarded', async (req, res) => {
  const updated = await users.updateUser(req.auth!.sub, { onboardedAt: new Date() });
  res.json({ user: toMeDto(updated) });
});

/** Owner-visible security audit log (§20), most recent first. */
usersRouter.get('/account/audit-log', async (req, res) => {
  const entries = await prisma.auditLogEntry.findMany({
    where: { userId: req.auth!.sub },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const items: AuditLogEntryDto[] = entries.map((entry) => ({
    id: entry.id,
    eventType: entry.eventType,
    ip: entry.ip,
    device: entry.device,
    createdAt: entry.createdAt.toISOString(),
  }));
  res.json({ items });
});
