import { Router, type Request, type Response } from 'express';
import {
  changePasswordSchema,
  emailTokenSchema,
  forgotPasswordSchema,
  LIMITS,
  loginBodySchema,
  magicLinkRequestSchema,
  otpVerifySchema,
  registerBodySchema,
  resetPasswordSchema,
  rotateEncryptionKeySchema,
  stepUpSchema,
  type AuthResultDto,
  type DeviceDto,
  type LoginBody,
  type OtpChallengeDto,
  type RegisterBody,
  type RotateEncryptionKeyBody,
  type StepUpBody,
} from '@pulsechat/shared';
import { env } from '../../config/env.js';
import * as auth from '../../services/auth.service.js';
import * as passwordFlows from '../../services/password-flows.service.js';
import * as backoff from '../../services/backoff.service.js';
import { assertHuman } from '../../services/turnstile.service.js';
import { verifyPendingToken } from '../../services/token.service.js';
import { toMeDto } from '../../services/me.serializer.js';
import * as devices from '../../repositories/device.repository.js';
import { recordAudit } from '../../services/audit.service.js';
import * as usersRepo from '../../repositories/user.repository.js';
import { AppError } from '../errors.js';
import { authLimiter, emailLimiter } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireSameOrigin } from '../middleware/require-same-origin.js';
import { requireStepUp } from '../middleware/require-step-up.js';
import { validateBody } from '../middleware/validate.js';

export const authRouter: Router = Router();

const REFRESH_COOKIE = 'pc_refresh';
const REFRESH_COOKIE_MAX_AGE_MS = LIMITS.REMEMBER_ME_REFRESH_DAYS * 24 * 60 * 60 * 1000;
const SESSION_ONLY_COOKIE_MAX_AGE_MS = LIMITS.SESSION_ONLY_REFRESH_HOURS * 60 * 60 * 1000;

function requestContext(req: Request): auth.RequestContext {
  return { ip: req.ip ?? 'unknown', userAgent: req.headers['user-agent'] ?? 'unknown' };
}

/**
 * §6.2 remember me: a 30-day cookie when the caller opted in, otherwise an
 * explicit maxAge matching the refresh token's own shorter server-side expiry
 * (`computeRefreshExpiry` in auth.service.ts). Deliberately NOT an
 * `Expires`-less "session cookie" — installed Android PWAs frequently purge
 * those on app close (separate task/WebAPK teardown), logging the user out
 * every relaunch even though the underlying token was still valid. An
 * explicit short maxAge gives the same "must re-auth without remember me"
 * guarantee while surviving that close/reopen cycle.
 *
 * `sameSite: 'none'` in production (not 'strict'): the web app (Vercel) and
 * this API (Render) are on different domains by design (see app.ts's CORS
 * setup) — that makes every request genuinely cross-site, and browsers
 * never attach a `sameSite: 'strict'`/`'lax'` cookie to a cross-site
 * request, including the app's own legitimate calls to its own API. That
 * silently dropped the cookie on every `/auth/refresh`, logging users out
 * on every page reload. `'none'` requires `secure: true` — the spec rejects
 * `SameSite=None` without it — so both flip together on the same
 * production check; local dev stays `'lax'`/insecure since `localhost:8000`
 * and `localhost:4000` are same-site (SameSite ignores port) and dev runs
 * over plain HTTP. CSRF protection for the two routes that trust this
 * cookie comes from the independent `requireSameOrigin` Origin/Referer
 * check, not from SameSite.
 */
function setRefreshCookie(res: Response, token: string, rememberMe: boolean): void {
  const isProd = env.NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/auth',
    maxAge: rememberMe ? REFRESH_COOKIE_MAX_AGE_MS : SESSION_ONLY_COOKIE_MAX_AGE_MS,
  });
}

function sessionResponse(res: Response, session: auth.IssuedSession, status = 200): void {
  setRefreshCookie(res, session.refreshToken, session.rememberMe);
  const body: AuthResultDto = { user: toMeDto(session.user), accessToken: session.accessToken };
  res.status(status).json(body);
}

authRouter.post(
  '/auth/register',
  authLimiter,
  validateBody(
    registerBodySchema.extend({ deviceFingerprint: loginBodySchema.shape.deviceFingerprint }),
  ),
  async (req, res) => {
    const body = req.body as RegisterBody & { deviceFingerprint: string };
    await assertHuman(body.turnstileToken, req.ip);
    const session = await auth.register(body, body.deviceFingerprint, requestContext(req));
    sessionResponse(res, session, 201);
  },
);

authRouter.post('/auth/login', authLimiter, validateBody(loginBodySchema), async (req, res) => {
  const body = req.body as LoginBody;
  const ip = req.ip ?? 'unknown';
  backoff.assertNotLockedOut(body.username, ip);
  await assertHuman(body.turnstileToken, req.ip);

  try {
    const outcome = await auth.login(
      body.username,
      body.password,
      body.deviceFingerprint,
      requestContext(req),
      body.rememberMe,
    );
    backoff.clearLoginFailures(body.username, ip);

    if (outcome.kind === 'otp_required') {
      const challenge: OtpChallengeDto = { otpRequired: true, pendingToken: outcome.pendingToken };
      res.status(202).json(challenge);
      return;
    }
    if (outcome.kind === 'device_confirm_required') {
      res.status(202).json({ deviceConfirmRequired: true, maskedEmail: outcome.maskedEmail });
      return;
    }
    sessionResponse(res, outcome.session);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHORIZED') {
      backoff.recordLoginFailure(body.username, ip);
    }
    throw error;
  }
});

authRouter.post(
  '/auth/otp/verify',
  authLimiter,
  validateBody(otpVerifySchema),
  async (req, res) => {
    const { pendingToken, code } = req.body as { pendingToken: string; code: string };
    const pending = await verifyPendingToken(pendingToken);
    const session = await auth.verifyOtp(
      pending.userId,
      pending.deviceFingerprint,
      code,
      requestContext(req),
      pending.rememberMe,
    );
    sessionResponse(res, session);
  },
);

authRouter.post(
  '/auth/magic-link',
  emailLimiter,
  validateBody(magicLinkRequestSchema),
  async (req, res) => {
    const { email, turnstileToken } = req.body as { email: string; turnstileToken?: string };
    await assertHuman(turnstileToken, req.ip);
    const result = await auth.requestMagicLink(email);
    res.status(202).json(result);
  },
);

authRouter.post(
  '/auth/magic-link/verify',
  authLimiter,
  validateBody(emailTokenSchema),
  async (req, res) => {
    const { token, deviceFingerprint } = req.body as {
      token: string;
      deviceFingerprint?: string;
    };
    if (!deviceFingerprint) {
      throw new AppError('VALIDATION_FAILED', 'deviceFingerprint is required', {
        deviceFingerprint: ['Required'],
      });
    }
    const session = await auth.verifyMagicLink(token, deviceFingerprint, requestContext(req));
    sessionResponse(res, session);
  },
);

authRouter.post(
  '/auth/verify-email',
  authLimiter,
  validateBody(emailTokenSchema),
  async (req, res) => {
    await auth.verifyEmail((req.body as { token: string }).token, requestContext(req));
    res.json({ verified: true });
  },
);

authRouter.post(
  '/auth/confirm-device',
  authLimiter,
  validateBody(emailTokenSchema),
  async (req, res) => {
    await auth.confirmDevice((req.body as { token: string }).token, requestContext(req));
    res.json({ confirmed: true });
  },
);

authRouter.post('/auth/refresh', requireSameOrigin, authLimiter, async (req, res) => {
  const raw: unknown = req.cookies?.[REFRESH_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AppError('UNAUTHORIZED', 'Session expired — sign in again');
  }
  const session = await auth.refreshSession(raw, requestContext(req));
  sessionResponse(res, session);
});

authRouter.post('/auth/logout', requireSameOrigin, requireAuth, async (req, res) => {
  await auth.logout(req.auth!.deviceId, requestContext(req));
  res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  res.json({ loggedOut: true });
});

authRouter.post(
  '/auth/forgot-password',
  emailLimiter,
  validateBody(forgotPasswordSchema),
  async (req, res) => {
    const { email, turnstileToken } = req.body as { email: string; turnstileToken?: string };
    await assertHuman(turnstileToken, req.ip);
    await passwordFlows.requestPasswordReset(email);
    res.status(202).json({ sent: true });
  },
);

authRouter.post(
  '/auth/reset-password',
  authLimiter,
  validateBody(resetPasswordSchema),
  async (req, res) => {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    await passwordFlows.resetPassword(token, newPassword, requestContext(req));
    res.json({ reset: true });
  },
);

authRouter.patch(
  '/account/password',
  requireAuth,
  authLimiter,
  validateBody(changePasswordSchema),
  async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    await passwordFlows.changePassword(
      req.auth!.sub,
      req.auth!.deviceId,
      currentPassword,
      newPassword,
      requestContext(req),
    );
    res.json({ changed: true });
  },
);

authRouter.patch(
  '/account/encryption-key',
  requireAuth,
  authLimiter,
  validateBody(rotateEncryptionKeySchema),
  async (req, res) => {
    const { currentPassword, publicKey } = req.body as RotateEncryptionKeyBody;
    const updated = await passwordFlows.rotateEncryptionKey(
      req.auth!.sub,
      currentPassword,
      publicKey,
      requestContext(req),
    );
    res.json({ user: toMeDto(updated) });
  },
);

// ── Email verification resend + 2FA toggle (§6.1, §6.5) ─────────────────────

authRouter.post('/auth/verify-email/resend', requireAuth, emailLimiter, async (req, res) => {
  const user = await usersRepo.findById(req.auth!.sub);
  if (!user?.email) {
    throw new AppError('VALIDATION_FAILED', 'No email on this account — add one in Settings');
  }
  if (user.emailVerified) {
    res.json({ alreadyVerified: true });
    return;
  }
  await auth.sendVerificationEmail(user.id, user.email);
  res.status(202).json({ sent: true });
});

authRouter.post('/auth/otp/enable', requireAuth, authLimiter, async (req, res) => {
  const user = await usersRepo.findById(req.auth!.sub);
  if (!user) throw new AppError('UNAUTHORIZED', 'Account unavailable');
  if (!user.email || !user.emailVerified) {
    throw new AppError('VALIDATION_FAILED', 'Two-factor login requires a verified email');
  }
  const updated = await usersRepo.updateUser(user.id, { otpEnabled: true });
  await recordAudit(user.id, 'otp_enabled', { ip: req.ip, device: req.headers['user-agent'] });
  res.json({ user: toMeDto(updated) });
});

authRouter.post('/auth/otp/disable', requireAuth, requireStepUp, authLimiter, async (req, res) => {
  const updated = await usersRepo.updateUser(req.auth!.sub, { otpEnabled: false });
  await recordAudit(req.auth!.sub, 'otp_disabled', {
    ip: req.ip,
    device: req.headers['user-agent'],
  });
  res.json({ user: toMeDto(updated) });
});

// ── Step-up re-auth (§6.2) ───────────────────────────────────────────────────

authRouter.post(
  '/auth/step-up',
  requireAuth,
  authLimiter,
  validateBody(stepUpSchema),
  async (req, res) => {
    const { password } = req.body as StepUpBody;
    res.json(await auth.stepUp(req.auth!.sub, req.auth!.deviceId, password));
  },
);

// ── Device / session management (§6.5) ───────────────────────────────────────

authRouter.get('/auth/devices', requireAuth, async (req, res) => {
  const list = await devices.listActiveForUser(req.auth!.sub);
  const items: DeviceDto[] = list.map((device) => ({
    id: device.id,
    userAgent: device.userAgent,
    recognized: device.recognized,
    lastSeenAt: device.lastSeenAt.toISOString(),
    createdAt: device.createdAt.toISOString(),
    current: device.id === req.auth!.deviceId,
  }));
  res.json({ items });
});

authRouter.delete('/auth/devices/:id', requireAuth, requireStepUp, async (req, res) => {
  const list = await devices.listActiveForUser(req.auth!.sub);
  const target = list.find((device) => device.id === req.params.id);
  if (!target) throw new AppError('NOT_FOUND', 'Session not found');
  await devices.revokeDevice(target.id);
  await recordAudit(req.auth!.sub, 'session_revoked', {
    ip: req.ip,
    device: target.userAgent,
  });
  res.json({ revoked: true });
});
