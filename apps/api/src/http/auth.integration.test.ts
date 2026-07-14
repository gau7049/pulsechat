import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** Captured outbound emails — the mock replaces the Brevo transport only. */
const sentEmails = vi.hoisted(
  () =>
    [] as Array<{
      to: string;
      subject: string;
      actionUrl?: string;
      bodyLines: string[];
    }>,
);

vi.mock('../services/email.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/email.service.js')>();
  return {
    ...actual,
    sendEmail: vi.fn(async (message: (typeof sentEmails)[number]) => {
      sentEmails.push(message);
    }),
  };
});

import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';

const app = createApp();

let counter = 0;
/** Unique per test: usernames ≤20 chars, fingerprints ≥8 chars. */
function uname(): string {
  counter += 1;
  return `u${Date.now().toString(36)}${counter}`.slice(0, 18);
}
function fp(label = 'a'): string {
  return `test-fingerprint-${label}-${counter}`;
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';
const PASSWORD = 'correct-horse-9';

interface RegisterOverrides {
  username?: string;
  email?: string;
  fingerprint?: string;
}

async function registerUser(overrides: RegisterOverrides = {}) {
  const username = overrides.username ?? uname();
  const res = await request(app)
    .post('/auth/register')
    .send({
      username,
      displayName: 'Test User',
      password: PASSWORD,
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: overrides.fingerprint ?? fp(),
      ...(overrides.email ? { email: overrides.email } : {}),
    });
  return { res, username };
}

function refreshCookie(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('pc_refresh='));
  expect(cookie, 'expected a pc_refresh cookie').toBeTruthy();
  return cookie!.split(';')[0]!;
}

function lastEmailToken(): string {
  const email = sentEmails.at(-1);
  expect(email?.actionUrl, 'expected an action link in the last email').toBeTruthy();
  return new URL(email!.actionUrl!).searchParams.get('token')!;
}

function lastOtpCode(): string {
  const email = sentEmails.at(-1);
  const match = email?.subject.match(/^(\d{6}) /);
  expect(match, 'expected a 6-digit code in the subject').toBeTruthy();
  return match![1]!;
}

beforeEach(() => {
  sentEmails.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/register', () => {
  it('creates an account, returns a session, sets the refresh cookie', async () => {
    const { res, username } = await registerUser();
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(username);
    expect(res.body.user.privacy.readReceipts).toBe(true);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBeNull();
    refreshCookie(res);
  });

  it('rejects duplicate usernames with 409', async () => {
    const { username } = await registerUser();
    const { res } = await registerUser({ username });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects invalid bodies with field details', async () => {
    const res = await request(app).post('/auth/register').send({
      username: 'admin', // reserved
      displayName: '',
      password: 'short',
      consent: false,
      publicKey: 'x',
      deviceFingerprint: fp(),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.username).toBeTruthy();
    expect(res.body.error.details.password).toBeTruthy();
    expect(res.body.error.details.consent).toBeTruthy();
  });

  it('sends a verification email when an email is provided', async () => {
    const { res } = await registerUser({ email: `${uname()}@gmail.com` });
    expect(res.status).toBe(201);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.subject).toMatch(/verify/i);
    expect(sentEmails[0]!.actionUrl).toContain('/verify-email?token=');
  });

  it('rejects non-gmail emails', async () => {
    const { res } = await registerUser({ email: 'someone@outlook.com' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.email).toBeTruthy();
  });
});

describe('POST /auth/login', () => {
  it('signs in with correct credentials', async () => {
    const { username } = await registerUser();
    const res = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('login') });
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
    refreshCookie(res);
  });

  it('rejects bad passwords and locks out after repeated failures', async () => {
    const { username } = await registerUser();
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ username, password: 'wrong-password-1', deviceFingerprint: fp() });
      expect(res.status).toBe(401);
    }
    const locked = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp() });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
  });

  it('returns the same 401 for unknown usernames', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: uname(), password: PASSWORD, deviceFingerprint: fp() });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/incorrect username or password/i);
  });
});

describe('token refresh & logout', () => {
  it('rotates the refresh token and invalidates the old one', async () => {
    const { res } = await registerUser();
    const oldCookie = refreshCookie(res);

    const refreshed = await request(app).post('/auth/refresh').set('Cookie', oldCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    const newCookie = refreshCookie(refreshed);
    expect(newCookie).not.toBe(oldCookie);

    // Reusing the rotated-out token must fail.
    const reused = await request(app).post('/auth/refresh').set('Cookie', oldCookie);
    expect(reused.status).toBe(401);
  });

  it('survives two concurrent refresh calls with the same token without corrupting the session', async () => {
    // Regression: React StrictMode (or any duplicate near-simultaneous call)
    // can present the same pre-rotation refresh cookie twice. The loser must
    // get a clean 401 — not silently clobber the winner's rotated token.
    const { res } = await registerUser();
    const oldCookie = refreshCookie(res);

    const [first, second] = await Promise.all([
      request(app).post('/auth/refresh').set('Cookie', oldCookie),
      request(app).post('/auth/refresh').set('Cookie', oldCookie),
    ]);
    const results = [first, second];
    const succeeded = results.filter((r) => r.status === 200);
    const failed = results.filter((r) => r.status === 401);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // The winner's new token is still fully valid — the session isn't stuck.
    const winnerCookie = refreshCookie(succeeded[0]!);
    const again = await request(app).post('/auth/refresh').set('Cookie', winnerCookie);
    expect(again.status).toBe(200);
  });

  it('logout revokes the device session', async () => {
    const { res } = await registerUser();
    const cookie = refreshCookie(res);
    const token = res.body.accessToken as string;

    const out = await request(app).post('/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);

    const afterLogout = await request(app).post('/auth/refresh').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });
});

describe('email verification + magic link', () => {
  it('verifies the email via the emailed token, then magic link signs in', async () => {
    const email = `${uname()}@gmail.com`;
    await registerUser({ email });
    const verifyToken = lastEmailToken();

    const verified = await request(app).post('/auth/verify-email').send({ token: verifyToken });
    expect(verified.status).toBe(200);

    sentEmails.length = 0;
    const requested = await request(app).post('/auth/magic-link').send({ email });
    expect(requested.status).toBe(202);
    const magicToken = lastEmailToken();

    const session = await request(app)
      .post('/auth/magic-link/verify')
      .send({ token: magicToken, deviceFingerprint: fp('magic') });
    expect(session.status).toBe(200);
    expect(session.body.user.emailVerified).toBe(true);

    // Single-use: the same link cannot sign in twice.
    const replay = await request(app)
      .post('/auth/magic-link/verify')
      .send({ token: magicToken, deviceFingerprint: fp('magic') });
    expect(replay.status).toBe(401);
  });

  it('accepts magic-link requests for unknown emails without leaking existence', async () => {
    const res = await request(app)
      .post('/auth/magic-link')
      .send({ email: `${uname()}@gmail.com` });
    expect(res.status).toBe(202);
    expect(sentEmails).toHaveLength(0);
  });
});

describe('new-device confirmation (§6.6)', () => {
  it('pauses login from an unrecognized device until the email link confirms it', async () => {
    const email = `${uname()}@gmail.com`;
    const { username } = await registerUser({ email });
    await request(app).post('/auth/verify-email').send({ token: lastEmailToken() });

    sentEmails.length = 0;
    const newFp = fp('new-device');
    const paused = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: newFp });
    expect(paused.status).toBe(202);
    expect(paused.body.deviceConfirmRequired).toBe(true);
    expect(paused.body.maskedEmail).toMatch(/\*+@gmail\.com$/);

    const confirmed = await request(app)
      .post('/auth/confirm-device')
      .send({ token: lastEmailToken() });
    expect(confirmed.status).toBe(200);

    const retry = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: newFp });
    expect(retry.status).toBe(200);
    expect(retry.body.accessToken).toBeTruthy();
  });
});

describe('email OTP 2FA (§6.5)', () => {
  it('challenges login with a 6-digit emailed code once enabled', async () => {
    const email = `${uname()}@gmail.com`;
    const deviceFingerprint = fp('otp-device');
    const { res, username } = await registerUser({ email, fingerprint: deviceFingerprint });
    const accessToken = res.body.accessToken as string;
    await request(app).post('/auth/verify-email').send({ token: lastEmailToken() });

    const enabled = await request(app)
      .post('/auth/otp/enable')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(enabled.status).toBe(200);
    expect(enabled.body.user.otpEnabled).toBe(true);

    sentEmails.length = 0;
    const challenged = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint });
    expect(challenged.status).toBe(202);
    expect(challenged.body.otpRequired).toBe(true);
    const pendingToken = challenged.body.pendingToken as string;
    const code = lastOtpCode();

    const wrong = await request(app)
      .post('/auth/otp/verify')
      .send({ pendingToken, code: code === '000000' ? '000001' : '000000' });
    expect(wrong.status).toBe(401);

    const session = await request(app).post('/auth/otp/verify').send({ pendingToken, code });
    expect(session.status).toBe(200);
    expect(session.body.user.username).toBe(username);
  });
});

describe('profile & privacy', () => {
  it('requires auth for /users/me', async () => {
    const res = await request(app).get('/users/me');
    expect(res.status).toBe(401);
  });

  it('updates profile fields, privacy settings, and onboarding state', async () => {
    const { res } = await registerUser();
    const token = res.body.accessToken as string;
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

    const profile = await auth(request(app).patch('/users/me')).send({
      displayName: 'Renamed User',
      bio: 'Hello world',
      visibility: 'friends',
    });
    expect(profile.status).toBe(200);
    expect(profile.body.user.displayName).toBe('Renamed User');
    expect(profile.body.user.visibility).toBe('friends');

    const privacy = await auth(request(app).patch('/users/me/privacy')).send({
      lastSeenVisibility: 'no_one',
      readReceipts: false,
    });
    expect(privacy.status).toBe(200);
    expect(privacy.body.user.privacy.lastSeenVisibility).toBe('no_one');
    expect(privacy.body.user.privacy.readReceipts).toBe(false);

    const onboarded = await auth(request(app).post('/users/me/onboarded')).send();
    expect(onboarded.status).toBe(200);
    expect(onboarded.body.user.onboardedAt).toBeTruthy();

    const empty = await auth(request(app).patch('/users/me')).send({});
    expect(empty.status).toBe(400);
  });

  it('records an audit trail visible to the owner', async () => {
    const { res } = await registerUser();
    const token = res.body.accessToken as string;
    const log = await request(app)
      .get('/account/audit-log')
      .set('Authorization', `Bearer ${token}`);
    expect(log.status).toBe(200);
    expect(log.body.items.some((e: { eventType: string }) => e.eventType === 'register')).toBe(
      true,
    );
  });
});

describe('password change', () => {
  it('rejects a wrong current password, then revokes other sessions on success', async () => {
    const { res, username } = await registerUser();
    const token = res.body.accessToken as string;

    const second = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('other') });
    expect(second.status).toBe(200);
    const secondCookie = refreshCookie(second);

    const wrong = await request(app)
      .patch('/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'not-the-password-1', newPassword: 'brand-new-pass-9' });
    expect(wrong.status).toBe(400);

    const changed = await request(app)
      .patch('/account/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-9' });
    expect(changed.status).toBe(200);

    // The other device's refresh token was revoked by the change.
    const otherRefresh = await request(app).post('/auth/refresh').set('Cookie', secondCookie);
    expect(otherRefresh.status).toBe(401);
  });
});

describe('device sessions', () => {
  it('lists active sessions and revokes one remotely (step-up required)', async () => {
    const { res, username } = await registerUser();
    const token = res.body.accessToken as string;

    const second = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('second') });
    const secondCookie = refreshCookie(second);

    const list = await request(app).get('/auth/devices').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    const current = list.body.items.find((d: { current: boolean }) => d.current);
    const other = list.body.items.find((d: { current: boolean }) => !d.current);
    expect(current).toBeTruthy();

    // §6.2 — revoking a session is step-up gated; no header at all is rejected.
    const withoutStepUp = await request(app)
      .delete(`/auth/devices/${other.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(withoutStepUp.status).toBe(403);
    expect(withoutStepUp.body.error.code).toBe('STEP_UP_REQUIRED');

    const stepUp = await request(app)
      .post('/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });
    expect(stepUp.status).toBe(200);

    const revoked = await request(app)
      .delete(`/auth/devices/${other.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-step-up-token', stepUp.body.stepUpToken as string);
    expect(revoked.status).toBe(200);

    const otherRefresh = await request(app).post('/auth/refresh').set('Cookie', secondCookie);
    expect(otherRefresh.status).toBe(401);
  });
});

describe('account lifecycle (§16)', () => {
  it('deactivate logs the account out everywhere; logging back in restores it', async () => {
    const { res, username } = await registerUser();
    const token = res.body.accessToken as string;

    const deactivated = await request(app)
      .post('/account/deactivate')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD });
    expect(deactivated.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { username } }))?.status).toBe('deactivated');

    const loggedBackIn = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('reactivate') });
    expect(loggedBackIn.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { username } }))?.status).toBe('active');
  });

  it('delete blocks login until the restore-email flow confirms it', async () => {
    const email = `${uname()}@gmail.com`;
    const { res, username } = await registerUser({ email });
    const token = res.body.accessToken as string;

    const deleted = await request(app)
      .post('/account/delete')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD });
    expect(deleted.status).toBe(200);

    const blockedLogin = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('after-delete') });
    expect(blockedLogin.status).toBe(403);

    sentEmails.length = 0;
    const requested = await request(app).post('/account/restore/request').send({ username });
    expect(requested.status).toBe(202);
    const restoreToken = lastEmailToken();

    const confirmed = await request(app)
      .post('/account/restore/confirm')
      .send({ token: restoreToken });
    expect(confirmed.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { username } }))?.status).toBe('active');

    const allowedLogin = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('restored') });
    expect(allowedLogin.status).toBe(200);
  });

  it('exports profile, posts, and message metadata as one JSON payload', async () => {
    const { res } = await registerUser();
    const token = res.body.accessToken as string;

    const exported = await request(app)
      .get('/account/export')
      .set('Authorization', `Bearer ${token}`);
    expect(exported.status).toBe(200);
    expect(exported.body.profile.passwordHash).toBeUndefined();
    expect(Array.isArray(exported.body.posts)).toBe(true);
    expect(exported.body.messages.note).toMatch(/end-to-end encrypted/);
  });
});
