import { createServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type MessageDto,
  type MessageSendAck,
} from '@pulsechat/shared';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';
import { setIo } from '../lib/io.js';
import { attachSockets } from '../sockets/index.js';

/**
 * M4 messaging-polish integration tests (Requirement Scope §14.3–14.11):
 * edit/delete, reactions, stars, reply/forward, and pin/mute/archive.
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
  return `m${Date.now().toString(36)}${counter}`.slice(0, 18);
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
      displayName: 'Polish Tester',
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

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function sendVia(
  socket: ClientSocket,
  conversationId: string,
  extra: Partial<{ replyToId: string; forwardedFromId: string }> = {},
): Promise<MessageSendAck> {
  return (await socket.timeout(5000).emitWithAck(CLIENT_EVENTS.MESSAGE_SEND, {
    conversationId,
    clientUuid: randomUUID(),
    ciphertext: CIPHERTEXT,
    nonce: NONCE,
    ...extra,
  })) as MessageSendAck;
}

/** A ready-made pair of friends with a conversation and one sent message. */
async function scenario() {
  const alice = await registerUser();
  const bob = await registerUser();
  await befriend(alice, bob);
  const conversationId = await createDirect(alice, bob);
  const aliceSocket = await connectSocket(alice);
  const ack = await sendVia(aliceSocket, conversationId);
  if (!ack.ok) throw new Error('scenario send failed');
  return { alice, bob, conversationId, aliceSocket, message: ack.message };
}

describe('edit & delete (§14.3)', () => {
  it('lets only the sender edit, and broadcasts the new content live', async () => {
    const { alice, bob, aliceSocket, message } = await scenario();
    const bobSocket = await connectSocket(bob);
    try {
      const newCiphertext = Buffer.from('edited-bytes').toString('base64');
      const edited = waitFor<MessageDto>(bobSocket, SERVER_EVENTS.MESSAGE_EDITED);

      expect(
        (
          await asUser(bob).patch(`/messages/${message.id}`, {
            ciphertext: newCiphertext,
            nonce: NONCE,
          })
        ).status,
      ).toBe(403);

      const res = await asUser(alice).patch(`/messages/${message.id}`, {
        ciphertext: newCiphertext,
        nonce: NONCE,
      });
      expect(res.status).toBe(200);
      expect(res.body.message.editedAt).toBeTruthy();

      const event = await edited;
      expect(event.ciphertext).toBe(newCiphertext);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  it('delete for everyone tombstones and drops the ciphertext', async () => {
    const { alice, bob, conversationId, aliceSocket, message } = await scenario();
    const bobSocket = await connectSocket(bob);
    try {
      expect((await asUser(bob).delete(`/messages/${message.id}?scope=everyone`)).status).toBe(403);

      const deleted = waitFor<{ messageId: string }>(bobSocket, SERVER_EVENTS.MESSAGE_DELETED);
      expect((await asUser(alice).delete(`/messages/${message.id}?scope=everyone`)).status).toBe(
        200,
      );
      expect((await deleted).messageId).toBe(message.id);

      const history = await asUser(bob).get(`/conversations/${conversationId}/messages`);
      const row = (history.body.items as MessageDto[]).find((m) => m.id === message.id);
      expect(row?.deletedForEveryoneAt).toBeTruthy();
      expect(row?.ciphertext).toBe('');

      // Editing or reacting to a tombstone conflicts.
      expect(
        (
          await asUser(alice).patch(`/messages/${message.id}`, {
            ciphertext: CIPHERTEXT,
            nonce: NONCE,
          })
        ).status,
      ).toBe(409);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  it('delete for me hides the message for that user only and fixes unread', async () => {
    const { alice, bob, conversationId, aliceSocket, message } = await scenario();
    try {
      expect((await asUser(bob).delete(`/messages/${message.id}?scope=me`)).status).toBe(200);

      const bobHistory = await asUser(bob).get(`/conversations/${conversationId}/messages`);
      expect(bobHistory.body.items).toHaveLength(0);
      const aliceHistory = await asUser(alice).get(`/conversations/${conversationId}/messages`);
      expect(aliceHistory.body.items).toHaveLength(1);

      // The hidden (never-read) message no longer counts as unread for bob.
      const conversations = await asUser(bob).get('/conversations');
      const convo = conversations.body.items.find((c: { id: string }) => c.id === conversationId);
      expect(convo.unreadCount).toBe(0);
    } finally {
      aliceSocket.disconnect();
    }
  });
});

describe('reactions (§14.4)', () => {
  it('toggles: add, replace, remove — with live fan-out', async () => {
    const { alice, bob, aliceSocket, message } = await scenario();
    try {
      const reactionEvent = waitFor<{ emoji: string | null; userId: string }>(
        aliceSocket,
        SERVER_EVENTS.MESSAGE_REACTION,
      );
      const add = await asUser(bob).post(`/messages/${message.id}/reactions`, { emoji: '👍' });
      expect(add.body.emoji).toBe('👍');
      expect((await reactionEvent).emoji).toBe('👍');

      const replace = await asUser(bob).post(`/messages/${message.id}/reactions`, {
        emoji: '❤️',
      });
      expect(replace.body.emoji).toBe('❤️');

      const history = await asUser(alice).get(`/conversations/${message.conversationId}/messages`);
      const row = (history.body.items as MessageDto[])[0]!;
      expect(row.reactions).toEqual([{ userId: bob.id, emoji: '❤️' }]);

      const remove = await asUser(bob).post(`/messages/${message.id}/reactions`, {
        emoji: '❤️',
      });
      expect(remove.body.emoji).toBeNull();
    } finally {
      aliceSocket.disconnect();
    }
  });
});

describe('starred messages (§14.6)', () => {
  it('stars privately and lists them with conversation context', async () => {
    const { alice, bob, aliceSocket, message } = await scenario();
    try {
      expect((await asUser(bob).post(`/messages/${message.id}/star`)).body.starred).toBe(true);

      // Private: alice's view of the message shows no star.
      const aliceHistory = await asUser(alice).get(
        `/conversations/${message.conversationId}/messages`,
      );
      expect((aliceHistory.body.items as MessageDto[])[0]!.starred).toBe(false);
      const bobHistory = await asUser(bob).get(`/conversations/${message.conversationId}/messages`);
      expect((bobHistory.body.items as MessageDto[])[0]!.starred).toBe(true);

      const starred = await asUser(bob).get('/messages/starred');
      expect(starred.body.items).toHaveLength(1);
      expect(starred.body.items[0].message.id).toBe(message.id);
      expect(starred.body.items[0].conversationLabel).toBe('Polish Tester');

      expect((await asUser(bob).post(`/messages/${message.id}/star`)).body.starred).toBe(false);
      const cleared = await asUser(bob).get('/messages/starred');
      expect(cleared.body.items).toHaveLength(0);
    } finally {
      aliceSocket.disconnect();
    }
  });
});

describe('reply & forward (§14.5)', () => {
  it('validates the reply target and stores the reference', async () => {
    const { alice, bob, conversationId, aliceSocket, message } = await scenario();
    const bobSocket = await connectSocket(bob);
    try {
      // A reply to a message from another conversation is rejected.
      const carol = await registerUser();
      await befriend(alice, carol);
      const otherConversation = await createDirect(alice, carol);
      const foreign = await sendVia(aliceSocket, otherConversation);
      if (!foreign.ok) throw new Error('foreign send failed');
      const bad = await sendVia(bobSocket, conversationId, { replyToId: foreign.message.id });
      expect(bad.ok).toBe(false);

      const good = await sendVia(bobSocket, conversationId, { replyToId: message.id });
      if (!good.ok) throw new Error('reply failed');
      expect(good.message.replyToId).toBe(message.id);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  it('allows forwarding only from conversations the sender belongs to', async () => {
    const { alice, aliceSocket, message } = await scenario();
    const carol = await registerUser();
    const dave = await registerUser();
    await befriend(alice, carol);
    await befriend(carol, dave);
    const aliceCarol = await createDirect(alice, carol);
    const carolDave = await createDirect(carol, dave);

    const carolSocket = await connectSocket(carol);
    try {
      // Carol cannot forward alice↔bob's message — she can't read it.
      const stolen = await sendVia(carolSocket, carolDave, { forwardedFromId: message.id });
      expect(stolen.ok).toBe(false);

      // Alice forwards her own message into her chat with carol.
      const forwarded = await sendVia(aliceSocket, aliceCarol, {
        forwardedFromId: message.id,
      });
      if (!forwarded.ok) throw new Error('forward failed');
      expect(forwarded.message.forwardedFromId).toBe(message.id);
    } finally {
      aliceSocket.disconnect();
      carolSocket.disconnect();
    }
  });
});

describe('conversation management (§14.11)', () => {
  it('persists pin/mute/archive per member', async () => {
    const { alice, bob, conversationId, aliceSocket } = await scenario();
    try {
      const res = await asUser(alice).patch(`/conversations/${conversationId}`, {
        pinned: true,
        muted: true,
      });
      expect(res.status).toBe(200);

      const list = await asUser(alice).get('/conversations');
      const convo = list.body.items.find((c: { id: string }) => c.id === conversationId);
      expect(convo.pinned).toBe(true);
      expect(convo.muted).toBe(true);
      expect(convo.archived).toBe(false);

      // The flags are per member — bob's view is untouched.
      const bobList = await asUser(bob).get('/conversations');
      const bobConvo = bobList.body.items.find((c: { id: string }) => c.id === conversationId);
      expect(bobConvo.pinned).toBe(false);

      expect((await asUser(alice).patch(`/conversations/${conversationId}`, {})).status).toBe(400);
    } finally {
      aliceSocket.disconnect();
    }
  });
});
