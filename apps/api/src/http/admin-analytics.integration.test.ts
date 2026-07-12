import { createServer, type Server as HttpServer } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';
import { setIo } from '../lib/io.js';
import { attachSockets } from '../sockets/index.js';

/**
 * M7 admin analytics dashboard integration tests (Requirement Scope §18.1,
 * Technical Spec §13) — schema-level, this file never queries Message.
 */

const app = createApp();
let httpServer: HttpServer;

beforeAll(async () => {
  httpServer = createServer(app);
  setIo(attachSockets(httpServer));
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });
  await prisma.$disconnect();
});

let counter = 0;
function uname(): string {
  counter += 1;
  return `a${Date.now().toString(36)}${counter}`.slice(0, 18);
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';
const PASSWORD = 'correct-horse-9';

interface TestUser {
  id: string;
  username: string;
  token: string;
}

async function registerUser(): Promise<TestUser> {
  const username = uname();
  const res = await request(app)
    .post('/auth/register')
    .send({
      username,
      displayName: 'Analytics Tester',
      password: PASSWORD,
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: `fingerprint-${username}`,
    });
  expect(res.status).toBe(201);
  return { id: res.body.user.id, username, token: res.body.accessToken };
}

async function makeAdmin(user: TestUser): Promise<TestUser> {
  await prisma.user.update({ where: { id: user.id }, data: { role: 'admin' } });
  const res = await request(app)
    .post('/auth/login')
    .send({
      username: user.username,
      password: PASSWORD,
      deviceFingerprint: `fingerprint-${user.username}`,
    });
  expect(res.status).toBe(200);
  return { ...user, token: res.body.accessToken };
}

function asUser(user: TestUser) {
  return {
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${user.token}`),
  };
}

describe('admin analytics (§18.1)', () => {
  it('rejects a non-admin', async () => {
    const alice = await registerUser();
    expect((await asUser(alice).get('/admin/analytics/summary')).status).toBe(403);
    expect(
      (await asUser(alice).get('/admin/analytics/timeseries?metric=sessions&range=7')).status,
    ).toBe(403);
  });

  it('returns a summary shaped for the dashboard stat tiles', async () => {
    const admin = await makeAdmin(await registerUser());
    const res = await asUser(admin).get('/admin/analytics/summary');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalUsers).toBe('number');
    expect(typeof res.body.activeNow).toBe('number');
    expect(typeof res.body.dau).toBe('number');
    expect(typeof res.body.wau).toBe('number');
    // The login just performed by this very test counts as a session_start.
    expect(res.body.dau).toBeGreaterThanOrEqual(1);
  });

  it('returns a bucketed timeseries for signups and sessions, rejecting a bad range', async () => {
    const admin = await makeAdmin(await registerUser());

    const signups = await asUser(admin).get('/admin/analytics/timeseries?metric=signups&range=7');
    expect(signups.status).toBe(200);
    expect(Array.isArray(signups.body.items)).toBe(true);

    const sessions = await asUser(admin).get(
      '/admin/analytics/timeseries?metric=sessions&range=30',
    );
    expect(sessions.status).toBe(200);
    expect(Array.isArray(sessions.body.items)).toBe(true);

    const badRange = await asUser(admin).get(
      '/admin/analytics/timeseries?metric=sessions&range=15',
    );
    expect(badRange.status).toBe(400);
  });
});
