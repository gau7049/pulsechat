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
 * M7 notification-center + Web Push integration tests (Technical Spec §12,
 * Requirement Scope §17). VAPID keys are unset in the test environment, so
 * push delivery itself no-ops — these tests cover the subscription store and
 * the notification history/read-state API on top of it.
 */

const app = createApp();
let httpServer: HttpServer;
let baseUrl = '';

beforeAll(async () => {
  httpServer = createServer(app);
  setIo(attachSockets(httpServer));
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address();
  if (typeof address === 'object' && address) baseUrl = `http://127.0.0.1:${address.port}`;
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
  return `n${Date.now().toString(36)}${counter}`.slice(0, 18);
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';
const WRAPPED_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef').toString(
  'base64',
);
const CIPHERTEXT = Buffer.from('some-encrypted-bytes').toString('base64');
const NONCE = Buffer.from('123456789012').toString('base64');

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
      displayName: 'Notif Tester',
      password: 'correct-horse-9',
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: `fingerprint-${username}`,
    });
  expect(res.status).toBe(201);
  return { id: res.body.user.id, username, token: res.body.accessToken };
}

function asUser(user: TestUser) {
  return {
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: object) =>
      request(app).post(path).set('Authorization', `Bearer ${user.token}`).send(body),
    patch: (path: string, body?: object) =>
      request(app).patch(path).set('Authorization', `Bearer ${user.token}`).send(body),
    delete: (path: string) =>
      request(app).delete(path).set('Authorization', `Bearer ${user.token}`),
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

describe('notification center (§12, §17)', () => {
  it('records a friend-request notification, lists it, and marks it read', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    await asUser(alice).post('/friend-requests', { toUserId: bob.id });

    const list = await asUser(bob).get('/notifications');
    expect(list.status).toBe(200);
    const row = list.body.items.find((n: { type: string }) => n.type === 'friend_request');
    expect(row).toBeTruthy();
    expect(row.readAt).toBeNull();

    const marked = await asUser(bob).patch(`/notifications/${row.id}/read`);
    expect(marked.status).toBe(200);
    const after = await asUser(bob).get('/notifications');
    const updated = after.body.items.find((n: { id: string }) => n.id === row.id);
    expect(updated.readAt).not.toBeNull();
  });

  it("rejects marking another user's notification read", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const eve = await registerUser();
    await asUser(alice).post('/friend-requests', { toUserId: bob.id });
    const list = await asUser(bob).get('/notifications');
    const row = list.body.items[0];

    const res = await asUser(eve).patch(`/notifications/${row.id}/read`);
    expect(res.status).toBe(404);
  });

  it('marks everything read via read-all', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await asUser(alice).post('/friend-requests', { toUserId: carol.id });
    await asUser(bob).post('/friend-requests', { toUserId: carol.id });

    expect((await asUser(carol).post('/notifications/read-all')).status).toBe(200);
    const list = await asUser(carol).get('/notifications');
    expect(list.body.items.every((n: { readAt: string | null }) => n.readAt !== null)).toBe(true);
  });

  it('stores and removes a push subscription', async () => {
    const alice = await registerUser();
    const endpoint = `https://push.example.test/${randomUUID()}`;

    const sub = await asUser(alice).post('/push/subscribe', {
      endpoint,
      keys: { p256dh: 'p256dh-key-value', auth: 'auth-secret-value' },
    });
    expect(sub.status).toBe(201);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).toBeTruthy();

    const del = await asUser(alice).delete(
      `/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
    );
    expect(del.status).toBe(200);
    expect(await prisma.pushSubscription.findUnique({ where: { endpoint } })).toBeNull();
  });

  it('sending a message to an offline recipient succeeds even though push is unconfigured', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversation = await asUser(alice).post('/conversations', {
      type: 'direct',
      members: [{ userId: bob.id, wrappedKey: WRAPPED_KEY }],
      myWrappedKey: WRAPPED_KEY,
    });

    const aliceSocket = await connectSocket(alice);
    try {
      // Bob has no live socket — exercises the offline push-fan-out path.
      const ack = (await aliceSocket.timeout(5000).emitWithAck(CLIENT_EVENTS.MESSAGE_SEND, {
        conversationId: conversation.body.conversation.id,
        clientUuid: randomUUID(),
        ciphertext: CIPHERTEXT,
        nonce: NONCE,
      })) as MessageSendAck;
      if (!ack.ok) throw new Error('send failed');
      expect(ack.message.id).toBeTruthy();
    } finally {
      aliceSocket.disconnect();
    }
  });
});
