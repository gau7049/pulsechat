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
  type MessageSyncAck,
} from '@pulsechat/shared';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';
import { setIo } from '../lib/io.js';
import { attachSockets } from '../sockets/index.js';

/**
 * M3 messaging integration tests (Requirement Scope §14–15, §21): REST
 * conversation management plus real Socket.IO round-trips for send/ack/
 * status/typing/sync — the same wire path production uses.
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
  return `c${Date.now().toString(36)}${counter}`.slice(0, 18);
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';
const PASSWORD = 'correct-horse-9';
const WRAPPED_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef').toString(
  'base64',
);

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
      displayName: 'Chat Tester',
      password: PASSWORD,
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
  expect(sent.status).toBe(201);
  const accepted = await asUser(b).patch(`/friend-requests/${sent.body.id}`, { action: 'accept' });
  expect(accepted.status).toBe(200);
}

async function createDirect(a: TestUser, b: TestUser): Promise<string> {
  const res = await asUser(a).post('/conversations', {
    type: 'direct',
    members: [{ userId: b.id, wrappedKey: WRAPPED_KEY }],
    myWrappedKey: WRAPPED_KEY,
  });
  expect([200, 201]).toContain(res.status);
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
    socket.on('connect_error', (error) => reject(error));
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

function sendMessage(
  socket: ClientSocket,
  conversationId: string,
  clientUuid = randomUUID(),
): Promise<MessageSendAck> {
  return socket.timeout(5000).emitWithAck(CLIENT_EVENTS.MESSAGE_SEND, {
    conversationId,
    clientUuid,
    ciphertext: WRAPPED_KEY,
    nonce: Buffer.from('123456789012').toString('base64'),
  }) as Promise<MessageSendAck>;
}

describe('conversations (REST)', () => {
  it('requires friendship, creates a direct conversation, and dedupes it', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    const stranger = await asUser(alice).post('/conversations', {
      type: 'direct',
      members: [{ userId: bob.id, wrappedKey: WRAPPED_KEY }],
      myWrappedKey: WRAPPED_KEY,
    });
    expect(stranger.status).toBe(403);

    await befriend(alice, bob);
    const first = await asUser(alice).post('/conversations', {
      type: 'direct',
      members: [{ userId: bob.id, wrappedKey: WRAPPED_KEY }],
      myWrappedKey: WRAPPED_KEY,
    });
    expect(first.status).toBe(201);
    expect(first.body.conversation.myWrappedKey).toBe(WRAPPED_KEY);

    // Same pair again — even initiated by the other side — reuses the room.
    const again = await asUser(bob).post('/conversations', {
      type: 'direct',
      members: [{ userId: alice.id, wrappedKey: WRAPPED_KEY }],
      myWrappedKey: WRAPPED_KEY,
    });
    expect(again.status).toBe(200);
    expect(again.body.conversation.id).toBe(first.body.conversation.id);

    const list = await asUser(bob).get('/conversations');
    expect(list.body.items.map((c: { id: string }) => c.id)).toContain(first.body.conversation.id);
  });

  it('validates group creation and manages membership', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    const dave = await registerUser();
    await befriend(alice, bob);
    await befriend(alice, carol);
    await befriend(alice, dave);

    const unnamed = await asUser(alice).post('/conversations', {
      type: 'group',
      members: [
        { userId: bob.id, wrappedKey: WRAPPED_KEY },
        { userId: carol.id, wrappedKey: WRAPPED_KEY },
      ],
      myWrappedKey: WRAPPED_KEY,
    });
    expect(unnamed.status).toBe(400);

    const created = await asUser(alice).post('/conversations', {
      type: 'group',
      name: 'Weekend crew',
      members: [
        { userId: bob.id, wrappedKey: WRAPPED_KEY },
        { userId: carol.id, wrappedKey: WRAPPED_KEY },
      ],
      myWrappedKey: WRAPPED_KEY,
    });
    expect(created.status).toBe(201);
    const groupId = created.body.conversation.id as string;
    expect(created.body.conversation.members).toHaveLength(3);

    // Only the admin (creator) adds members.
    const nonAdmin = await asUser(bob).post(`/conversations/${groupId}/members`, {
      userId: dave.id,
      wrappedKey: WRAPPED_KEY,
    });
    expect(nonAdmin.status).toBe(403);
    const added = await asUser(alice).post(`/conversations/${groupId}/members`, {
      userId: dave.id,
      wrappedKey: WRAPPED_KEY,
    });
    expect(added.status).toBe(201);

    // A member can leave; a non-admin cannot remove someone else.
    expect((await asUser(carol).delete(`/conversations/${groupId}/members/${bob.id}`)).status).toBe(
      403,
    );
    expect(
      (await asUser(carol).delete(`/conversations/${groupId}/members/${carol.id}`)).status,
    ).toBe(200);

    const list = await asUser(carol).get('/conversations');
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(groupId);
  });

  it('locks a direct conversation when a block exists (§10.2)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversationId = await createDirect(alice, bob);
    await asUser(alice).post('/blocks', { userId: bob.id });

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    try {
      const fromBlocked = await sendMessage(bobSocket, conversationId);
      expect(fromBlocked.ok).toBe(false);
      const fromBlocker = await sendMessage(aliceSocket, conversationId);
      expect(fromBlocker.ok).toBe(false);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });
});

describe('messaging over the socket', () => {
  it('rejects unauthenticated sockets', async () => {
    await expect(
      connectSocket({ id: 'x', username: 'x', token: 'not-a-jwt' }),
    ).rejects.toBeTruthy();
  });

  it('delivers a message live, tracks status through read, and orders strictly', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversationId = await createDirect(alice, bob);

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    try {
      const incoming = waitFor<MessageDto>(bobSocket, SERVER_EVENTS.MESSAGE_NEW);
      const ack = await sendMessage(aliceSocket, conversationId);
      if (!ack.ok) throw new Error(`send failed: ${ack.message}`);
      expect(ack.message.sequence).toBe(1);

      const received = await incoming;
      expect(received.id).toBe(ack.message.id);

      // Bob acks read → Alice sees a live read status (§21.1).
      const statusEvent = waitFor<{ state: string; userId: string; upToSequence: number }>(
        aliceSocket,
        SERVER_EVENTS.MESSAGE_STATUS,
      );
      bobSocket.emit(CLIENT_EVENTS.MESSAGE_ACK, {
        conversationId,
        upToSequence: received.sequence,
        state: 'read',
      });
      const status = await statusEvent;
      expect(status.state).toBe('read');
      expect(status.userId).toBe(bob.id);

      // Strict ordering: two more messages get 2 and 3 (§21.2).
      const second = await sendMessage(aliceSocket, conversationId);
      const third = await sendMessage(aliceSocket, conversationId);
      if (!second.ok || !third.ok) throw new Error('follow-up sends failed');
      expect(second.message.sequence).toBe(2);
      expect(third.message.sequence).toBe(3);

      // History reflects read state on the first message.
      const history = await asUser(alice).get(`/conversations/${conversationId}/messages`);
      const items = history.body.items as MessageDto[];
      expect(items.map((m) => m.sequence)).toEqual([3, 2, 1]);
      expect(items.find((m) => m.sequence === 1)?.aggregateState).toBe('read');

      // Unread count for bob: two unread (he read only sequence 1).
      const conversations = await asUser(bob).get('/conversations');
      const convo = conversations.body.items.find((c: { id: string }) => c.id === conversationId);
      expect(convo.unreadCount).toBe(2);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  it('is idempotent per client_uuid (§21.2)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversationId = await createDirect(alice, bob);

    const aliceSocket = await connectSocket(alice);
    try {
      const clientUuid = randomUUID();
      const first = await sendMessage(aliceSocket, conversationId, clientUuid);
      const retry = await sendMessage(aliceSocket, conversationId, clientUuid);
      if (!first.ok || !retry.ok) throw new Error('sends failed');
      expect(retry.message.id).toBe(first.message.id);

      const history = await asUser(alice).get(`/conversations/${conversationId}/messages`);
      expect(history.body.items).toHaveLength(1);
    } finally {
      aliceSocket.disconnect();
    }
  });

  it('replays missed messages on sync and marks them delivered (§21.2)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversationId = await createDirect(alice, bob);

    // Bob is offline while Alice sends two messages.
    const aliceSocket = await connectSocket(alice);
    try {
      await sendMessage(aliceSocket, conversationId);
      await sendMessage(aliceSocket, conversationId);

      const breakdownBefore = await asUser(alice).get(`/conversations/${conversationId}/messages`);
      expect(
        (breakdownBefore.body.items as MessageDto[]).every((m) => m.aggregateState === 'sent'),
      ).toBe(true);

      const statusEvent = waitFor<{ state: string }>(aliceSocket, SERVER_EVENTS.MESSAGE_STATUS);
      const bobSocket = await connectSocket(bob);
      try {
        const sync = (await bobSocket.timeout(5000).emitWithAck(CLIENT_EVENTS.MESSAGE_SYNC, {
          conversations: [{ conversationId, lastSequence: 0 }],
        })) as MessageSyncAck;
        if (!sync.ok) throw new Error('sync failed');
        expect(sync.messages.map((m) => m.sequence)).toEqual([1, 2]);

        expect((await statusEvent).state).toBe('delivered');
      } finally {
        bobSocket.disconnect();
      }
    } finally {
      aliceSocket.disconnect();
    }
  });

  it('degrades read receipts to delivered when either side opts out (§14.1)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversationId = await createDirect(alice, bob);
    await asUser(bob).patch('/users/me/privacy', { readReceipts: false });

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    try {
      const incoming = waitFor<MessageDto>(bobSocket, SERVER_EVENTS.MESSAGE_NEW);
      const ack = await sendMessage(aliceSocket, conversationId);
      if (!ack.ok) throw new Error('send failed');
      await incoming;

      const statusEvent = waitFor<{ state: string }>(aliceSocket, SERVER_EVENTS.MESSAGE_STATUS);
      bobSocket.emit(CLIENT_EVENTS.MESSAGE_ACK, {
        conversationId,
        upToSequence: 1,
        state: 'read',
      });
      expect((await statusEvent).state).toBe('delivered');

      // Aggregate and breakdown agree: delivered, never read.
      const history = await asUser(alice).get(`/conversations/${conversationId}/messages`);
      expect((history.body.items as MessageDto[])[0]?.aggregateState).toBe('delivered');
      const breakdown = await asUser(alice).get(`/messages/${ack.message.id}/statuses`);
      expect(breakdown.body.items[0].state).toBe('delivered');

      // But bob's own unread count is truthful — he did read it.
      const conversations = await asUser(bob).get('/conversations');
      const convo = conversations.body.items.find((c: { id: string }) => c.id === conversationId);
      expect(convo.unreadCount).toBe(0);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  it('relays typing indicators to other members only (§14.10)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    const conversationId = await createDirect(alice, bob);

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    try {
      const typing = waitFor<{ userId: string; typing: boolean }>(
        bobSocket,
        SERVER_EVENTS.TYPING_UPDATE,
      );
      aliceSocket.emit(CLIENT_EVENTS.TYPING_START, { conversationId });
      const event = await typing;
      expect(event.userId).toBe(alice.id);
      expect(event.typing).toBe(true);
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
    }
  });

  it('broadcasts presence to friends and respects the sender breakdown (§14.2)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);
    await befriend(alice, carol);

    const group = await asUser(alice).post('/conversations', {
      type: 'group',
      name: 'Status check',
      members: [
        { userId: bob.id, wrappedKey: WRAPPED_KEY },
        { userId: carol.id, wrappedKey: WRAPPED_KEY },
      ],
      myWrappedKey: WRAPPED_KEY,
    });
    const groupId = group.body.conversation.id as string;

    const aliceSocket = await connectSocket(alice);
    try {
      // Presence: alice (online, friend) hears bob come online.
      const presence = waitFor<{ userId: string; online: boolean }>(
        aliceSocket,
        SERVER_EVENTS.PRESENCE_UPDATE,
      );
      const bobSocket = await connectSocket(bob);
      try {
        const event = await presence;
        expect(event.userId).toBe(bob.id);
        expect(event.online).toBe(true);

        // Bob is online (notified+read later), carol never connected.
        const incoming = waitFor<MessageDto>(bobSocket, SERVER_EVENTS.MESSAGE_NEW);
        const ack = await sendMessage(aliceSocket, groupId);
        if (!ack.ok) throw new Error('send failed');
        const received = await incoming;
        bobSocket.emit(CLIENT_EVENTS.MESSAGE_ACK, {
          conversationId: groupId,
          upToSequence: received.sequence,
          state: 'read',
        });
        await waitFor(aliceSocket, SERVER_EVENTS.MESSAGE_STATUS);

        const breakdown = await asUser(alice).get(`/messages/${ack.message.id}/statuses`);
        const rows = breakdown.body.items as Array<{
          user: { id: string };
          state: string | null;
        }>;
        expect(rows).toHaveLength(2);
        expect(rows.find((r) => r.user.id === bob.id)?.state).toBe('read');
        expect(rows.find((r) => r.user.id === carol.id)?.state).toBeNull();

        // Only the sender may see the breakdown.
        expect((await asUser(bob).get(`/messages/${ack.message.id}/statuses`)).status).toBe(403);
      } finally {
        bobSocket.disconnect();
      }
    } finally {
      aliceSocket.disconnect();
    }
  });
});
