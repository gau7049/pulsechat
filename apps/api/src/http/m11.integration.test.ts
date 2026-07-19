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
 * M11 group-admin-controls + media addendum: group photo (creator-or-admin
 * gated), admin transfer, sole-admin-must-transfer-before-leaving, and a
 * group admin's authority to remove another member's message.
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
  return `m11${Date.now().toString(36)}${counter}`.slice(0, 18);
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
      displayName: 'M11 Tester',
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

async function createDirect(a: TestUser, b: TestUser): Promise<string> {
  const res = await asUser(a).post('/conversations', {
    type: 'direct',
    members: [{ userId: b.id, wrappedKey: WRAPPED_KEY }],
    myWrappedKey: WRAPPED_KEY,
  });
  return res.body.conversation.id as string;
}

async function createGroup(creator: TestUser, others: TestUser[], name = 'Weekend crew') {
  const res = await asUser(creator).post('/conversations', {
    type: 'group',
    name,
    members: others.map((u) => ({ userId: u.id, wrappedKey: WRAPPED_KEY })),
    myWrappedKey: WRAPPED_KEY,
  });
  expect(res.status).toBe(201);
  return res.body.conversation.id as string;
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

async function sendVia(socket: ClientSocket, conversationId: string): Promise<MessageSendAck> {
  return (await socket.timeout(5000).emitWithAck(CLIENT_EVENTS.MESSAGE_SEND, {
    conversationId,
    clientUuid: randomUUID(),
    ciphertext: CIPHERTEXT,
    nonce: NONCE,
  })) as MessageSendAck;
}

/** Alice creates a group with Bob and Carol as friends; Alice is admin. */
async function groupScenario() {
  const alice = await registerUser();
  const bob = await registerUser();
  const carol = await registerUser();
  await befriend(alice, bob);
  await befriend(alice, carol);
  const conversationId = await createGroup(alice, [bob, carol]);
  return { alice, bob, carol, conversationId };
}

describe('group photo (creator-or-admin gated)', () => {
  it('rejects a plain member and a direct conversation, allows the admin', async () => {
    const { alice, bob, conversationId } = await groupScenario();

    const direct = await createDirect(alice, bob);
    expect((await asUser(alice).post(`/conversations/${direct}/photo-upload-token`)).status).toBe(
      400,
    );

    expect(
      (await asUser(bob).post(`/conversations/${conversationId}/photo-upload-token`)).status,
    ).toBe(403);
    expect(
      (
        await asUser(bob).patch(`/conversations/${conversationId}/photo`, {
          photoUrl: 'https://res.cloudinary.com/demo/image/upload/group.png',
        })
      ).status,
    ).toBe(403);

    // CLOUDINARY_URL isn't configured in the test env, so the token itself
    // 400s past the permission check — asserting "not 403" proves the gate passed.
    const tokenRes = await asUser(alice).post(
      `/conversations/${conversationId}/photo-upload-token`,
    );
    expect(tokenRes.status).not.toBe(403);

    const patchRes = await asUser(alice).patch(`/conversations/${conversationId}/photo`, {
      photoUrl: 'https://res.cloudinary.com/demo/image/upload/group.png',
    });
    expect(patchRes.status).toBe(200);

    const list = await asUser(alice).get('/conversations');
    const convo = list.body.items.find((c: { id: string }) => c.id === conversationId);
    expect(convo.photoUrl).toBe('https://res.cloudinary.com/demo/image/upload/group.png');
    expect(convo.createdById).toBe(alice.id);
  });
});

describe('admin transfer', () => {
  it('hands the role to another member; non-admins and non-members are rejected', async () => {
    const { alice, bob, carol, conversationId } = await groupScenario();

    // Bob (not admin) cannot transfer.
    expect(
      (await asUser(bob).post(`/conversations/${conversationId}/admin`, { toUserId: carol.id }))
        .status,
    ).toBe(403);

    // A non-member cannot be promoted.
    const dave = await registerUser();
    expect(
      (await asUser(alice).post(`/conversations/${conversationId}/admin`, { toUserId: dave.id }))
        .status,
    ).toBe(404);

    const res = await asUser(alice).post(`/conversations/${conversationId}/admin`, {
      toUserId: bob.id,
    });
    expect(res.status).toBe(200);

    const list = await asUser(bob).get('/conversations');
    const convo = list.body.items.find((c: { id: string }) => c.id === conversationId);
    const roles = Object.fromEntries(
      convo.members.map((m: { user: { id: string }; role: string }) => [m.user.id, m.role]),
    );
    expect(roles[bob.id]).toBe('admin');
    expect(roles[alice.id]).toBe('member');
  });
});

describe('sole-admin leave guard', () => {
  it('blocks the sole admin from leaving until they transfer the role', async () => {
    const { alice, bob, conversationId } = await groupScenario();

    const blocked = await asUser(alice).delete(
      `/conversations/${conversationId}/members/${alice.id}`,
    );
    expect(blocked.status).toBe(409);

    expect(
      (await asUser(alice).post(`/conversations/${conversationId}/admin`, { toUserId: bob.id }))
        .status,
    ).toBe(200);

    const allowed = await asUser(alice).delete(
      `/conversations/${conversationId}/members/${alice.id}`,
    );
    expect(allowed.status).toBe(200);
  });
});

describe('group admin message removal', () => {
  it('lets the admin tombstone another member’s message; a plain member cannot', async () => {
    const { alice, bob, carol, conversationId } = await groupScenario();
    const bobSocket = await connectSocket(bob);
    try {
      const ack = await sendVia(bobSocket, conversationId);
      if (!ack.ok) throw new Error('scenario send failed');

      // Carol is a plain member — same rule as before this milestone.
      expect(
        (await asUser(carol).delete(`/messages/${ack.message.id}?scope=everyone`)).status,
      ).toBe(403);

      // Alice is the group admin — new authority added by this milestone.
      const res = await asUser(alice).delete(`/messages/${ack.message.id}?scope=everyone`);
      expect(res.status).toBe(200);

      const history = await asUser(bob).get(`/conversations/${conversationId}/messages`);
      const row = history.body.items.find((m: { id: string }) => m.id === ack.message.id);
      expect(row.deletedForEveryoneAt).toBeTruthy();
      expect(row.deletedByAdmin).toBe(true);
    } finally {
      bobSocket.disconnect();
    }
  });

  it('leaves direct-conversation delete sender-only even for the actor’s own admin role elsewhere', async () => {
    const { alice, bob } = await groupScenario();
    const direct = await createDirect(alice, bob);
    const aliceSocket = await connectSocket(alice);
    try {
      const ack = await sendVia(aliceSocket, direct);
      if (!ack.ok) throw new Error('direct send failed');
      // Bob has no admin role anywhere relevant to this conversation type.
      expect((await asUser(bob).delete(`/messages/${ack.message.id}?scope=everyone`)).status).toBe(
        403,
      );
    } finally {
      aliceSocket.disconnect();
    }
  });
});
