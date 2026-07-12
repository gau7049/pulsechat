import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, type MessageSendAck } from '@pulsechat/shared';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';
import { setIo } from '../lib/io.js';
import { attachSockets } from '../sockets/index.js';

/**
 * M7 moderation queue integration tests (Requirement Scope §18, Technical
 * Spec §13): reports, the admin action matrix, and the `suspended` account
 * status it introduces.
 */

const app = createApp();
let httpServer: HttpServer;
let baseUrl = '';
let admin: TestUser;

beforeAll(async () => {
  httpServer = createServer(app);
  setIo(attachSockets(httpServer));
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (typeof address === 'object' && address) baseUrl = `http://127.0.0.1:${address.port}`;
  // Shared across every test below — minting a fresh admin per test multiplies
  // register+login round trips for no benefit (reports are independent rows).
  admin = await makeAdmin(await registerUser());
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
  return `r${Date.now().toString(36)}${counter}`.slice(0, 18);
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';
const WRAPPED_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef').toString(
  'base64',
);
const CIPHERTEXT = Buffer.from('some-encrypted-bytes').toString('base64');
const NONCE = Buffer.from('123456789012').toString('base64');
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
      displayName: 'Mod Tester',
      password: PASSWORD,
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: `fingerprint-${username}`,
    });
  expect(res.status).toBe(201);
  return { id: res.body.user.id, username, token: res.body.accessToken };
}

/** Promotes a user to admin in the DB, then re-logs-in for a token carrying the fresh role claim. */
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
    post: (path: string, body?: object) =>
      request(app).post(path).set('Authorization', `Bearer ${user.token}`).send(body),
    patch: (path: string, body?: object) =>
      request(app).patch(path).set('Authorization', `Bearer ${user.token}`).send(body),
  };
}

async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const sent = await asUser(a).post('/friend-requests', { toUserId: b.id });
  const accepted = await asUser(b).patch(`/friend-requests/${sent.body.id}`, { action: 'accept' });
  expect(accepted.status).toBe(200);
}

function connectSocket(user: TestUser): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      auth: { token: user.token },
      transports: ['websocket'],
      reconnection: false,
    });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

async function createPost(author: TestUser) {
  const res = await asUser(author).post('/posts', {
    mediaUrl: 'https://res.cloudinary.com/demo/image/upload/v1/sample.jpg',
    caption: 'reportable content',
  });
  expect(res.status).toBe(201);
  return res.body.post.id as string;
}

async function sendMessage(sender: TestUser, conversationId: string): Promise<string> {
  const socket = await connectSocket(sender);
  try {
    const ack = (await socket.timeout(5000).emitWithAck(CLIENT_EVENTS.MESSAGE_SEND, {
      conversationId,
      clientUuid: randomUUID(),
      ciphertext: CIPHERTEXT,
      nonce: NONCE,
    })) as MessageSendAck;
    if (!ack.ok) throw new Error('send failed');
    return ack.message.id;
  } finally {
    socket.disconnect();
  }
}

describe('reports (§18)', () => {
  it('rejects a non-admin from the moderation queue', async () => {
    const alice = await registerUser();
    expect((await asUser(alice).get('/admin/reports')).status).toBe(403);
  });

  it('files a post report and lists it for an admin', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const postId = await createPost(bob);

    const filed = await asUser(alice).post('/reports', {
      targetType: 'post',
      targetId: postId,
      reason: 'spam',
    });
    expect(filed.status).toBe(201);

    const queue = await asUser(admin).get('/admin/reports?status=open');
    expect(queue.status).toBe(200);
    const row = queue.body.items.find((r: { targetId: string }) => r.targetId === postId);
    expect(row).toBeTruthy();
    expect(row.preview.kind).toBe('post');
    expect(row.preview.caption).toBe('reportable content');
  });

  it('rejects a message report from a non-member of the conversation', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const eve = await registerUser();
    await befriend(alice, bob);
    const conv = await asUser(alice).post('/conversations', {
      type: 'direct',
      members: [{ userId: bob.id, wrappedKey: WRAPPED_KEY }],
      myWrappedKey: WRAPPED_KEY,
    });
    const messageId = await sendMessage(alice, conv.body.conversation.id);

    const res = await asUser(eve).post('/reports', {
      targetType: 'message',
      targetId: messageId,
      reason: 'abuse',
    });
    expect(res.status).toBe(404);

    const ok = await asUser(bob).post('/reports', {
      targetType: 'message',
      targetId: messageId,
      reason: 'abuse',
    });
    expect(ok.status).toBe(201);
  });

  it('warn notifies the content owner without removing anything', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const postId = await createPost(bob);
    await asUser(alice).post('/reports', { targetType: 'post', targetId: postId, reason: 'rude' });

    const queue = await asUser(admin).get('/admin/reports?status=open');
    const reportId = queue.body.items[0].id as string;
    const actioned = await asUser(admin).patch(`/admin/reports/${reportId}`, { action: 'warn' });
    expect(actioned.status).toBe(200);

    expect(await prisma.post.findUnique({ where: { id: postId } })).toBeTruthy();
    const bobNotifs = await asUser(bob).get('/notifications');
    expect(
      bobNotifs.body.items.some((n: { type: string }) => n.type === 'moderation_warning'),
    ).toBe(true);
  });

  it('remove deletes the reported post and rejects profile targets', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const postId = await createPost(bob);
    await asUser(alice).post('/reports', { targetType: 'post', targetId: postId, reason: 'nope' });

    const queue = await asUser(admin).get('/admin/reports?status=open');
    const row = queue.body.items.find((r: { targetId: string }) => r.targetId === postId);
    const removed = await asUser(admin).patch(`/admin/reports/${row.id}`, { action: 'remove' });
    expect(removed.status).toBe(200);
    expect(await prisma.post.findUnique({ where: { id: postId } })).toBeNull();

    const profileReport = await asUser(alice).post('/reports', {
      targetType: 'profile',
      targetId: bob.id,
      reason: 'fake account',
    });
    expect(profileReport.status).toBe(201);
    const queue2 = await asUser(admin).get('/admin/reports?status=open');
    const profileRow = queue2.body.items.find(
      (r: { targetType: string }) => r.targetType === 'profile',
    );
    const rejected = await asUser(admin).patch(`/admin/reports/${profileRow.id}`, {
      action: 'remove',
    });
    expect(rejected.status).toBe(400);
  });

  it('suspend blocks login until an admin restores active status', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await asUser(alice).post('/reports', {
      targetType: 'profile',
      targetId: bob.id,
      reason: 'harassment',
    });

    const queue = await asUser(admin).get('/admin/reports?status=open');
    const row = queue.body.items.find((r: { targetType: string }) => r.targetType === 'profile');
    expect(
      (await asUser(admin).patch(`/admin/reports/${row.id}`, { action: 'suspend' })).status,
    ).toBe(200);

    const blocked = await request(app)
      .post('/auth/login')
      .send({
        username: bob.username,
        password: PASSWORD,
        deviceFingerprint: `fingerprint-${bob.username}`,
      });
    expect(blocked.status).toBe(403);

    const restored = await asUser(admin).patch(`/admin/users/${bob.id}/status`, {
      status: 'active',
    });
    expect(restored.status).toBe(200);
    const allowed = await request(app)
      .post('/auth/login')
      .send({
        username: bob.username,
        password: PASSWORD,
        deviceFingerprint: `fingerprint-${bob.username}`,
      });
    expect(allowed.status).toBe(200);
  });

  it('dismiss just closes the report', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const postId = await createPost(bob);
    await asUser(alice).post('/reports', { targetType: 'post', targetId: postId, reason: 'meh' });
    const queue = await asUser(admin).get('/admin/reports?status=open');
    const row = queue.body.items.find((r: { targetId: string }) => r.targetId === postId);

    const dismissed = await asUser(admin).patch(`/admin/reports/${row.id}`, { action: 'dismiss' });
    expect(dismissed.status).toBe(200);
    const reviewedQueue = await asUser(admin).get('/admin/reports?status=reviewed');
    expect(reviewedQueue.body.items.some((r: { id: string }) => r.id === row.id)).toBe(true);
  });
});
