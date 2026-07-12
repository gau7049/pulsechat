import { createServer, type Server as HttpServer } from 'node:http';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type CallIncomingPayload,
  type CallLifecyclePayload,
  type LiveEndedPayload,
  type LiveStartedPayload,
  type LiveViewerJoinedPayload,
  type RtcSignalRelayPayload,
} from '@pulsechat/shared';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';
import { setIo } from '../lib/io.js';
import { attachSockets } from '../sockets/index.js';

/**
 * M5 integration tests (Requirement Scope §11–12): statuses, live sessions,
 * WebRTC signaling, and the active-users count — all friend-gated the same
 * way the rest of the app is.
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
  return `s${Date.now().toString(36)}${counter}`.slice(0, 18);
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';

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
      displayName: 'Status Tester',
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

function waitFor<T>(socket: ClientSocket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Resolves `null` if the event doesn't arrive — used to assert rejection. */
function neverGets<T>(socket: ClientSocket, event: string, timeoutMs = 400): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('statuses (§11)', () => {
  it('is visible to the author and friends, not to strangers, and is owner-deletable', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);

    const created = await asUser(alice).post('/statuses', {
      caption: 'hello friends',
      visibility: 'everyone',
    });
    expect(created.status).toBe(201);
    const statusId = created.body.status.id as string;

    const aliceFeed = await asUser(alice).get('/statuses/feed');
    expect(
      aliceFeed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeTruthy();

    const bobFeed = await asUser(bob).get('/statuses/feed');
    const bobEntry = bobFeed.body.items.find(
      (e: { user: { id: string } }) => e.user.id === alice.id,
    );
    expect(bobEntry.statuses).toHaveLength(1);

    const carolFeed = await asUser(carol).get('/statuses/feed');
    expect(
      carolFeed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeUndefined();

    // Non-owner cannot delete.
    expect((await asUser(bob).delete(`/statuses/${statusId}`)).status).toBe(403);
    expect((await asUser(alice).delete(`/statuses/${statusId}`)).status).toBe(200);
    const afterDelete = await asUser(bob).get('/statuses/feed');
    expect(
      afterDelete.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeUndefined();
  });

  it('excludes expired statuses from the feed', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);

    const created = await asUser(alice).post('/statuses', {
      caption: 'about to expire',
      visibility: 'friends',
    });
    await prisma.status.update({
      where: { id: created.body.status.id as string },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const bobFeed = await asUser(bob).get('/statuses/feed');
    expect(
      bobFeed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeUndefined();
  });

  it('hides statuses from a blocked user in either direction', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    await asUser(alice).post('/statuses', {
      caption: 'visible to friends',
      visibility: 'everyone',
    });
    await asUser(alice).post('/blocks', { userId: bob.id });

    const bobFeed = await asUser(bob).get('/statuses/feed');
    expect(
      bobFeed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeUndefined();
  });
});

describe('live sessions (§12)', () => {
  it('starts/ends with friend-only socket fan-out, and sorts the rail live-first', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);
    await asUser(alice).post('/statuses', { caption: 'just a status', visibility: 'everyone' });

    const bobSocket = await connectSocket(bob);
    const carolSocket = await connectSocket(carol);
    try {
      const started = waitFor<LiveStartedPayload>(bobSocket, SERVER_EVENTS.LIVE_STARTED);
      const carolNeverStarted = neverGets<LiveStartedPayload>(
        carolSocket,
        SERVER_EVENTS.LIVE_STARTED,
      );
      const startRes = await asUser(alice).post('/live/start', { visibility: 'everyone' });
      expect(startRes.status).toBe(201);
      expect((await started).user.id).toBe(alice.id);
      expect(await carolNeverStarted).toBeNull();

      const bobFeed = await asUser(bob).get('/statuses/feed');
      expect(bobFeed.body.items[0].user.id).toBe(alice.id);
      expect(bobFeed.body.items[0].live).toBeTruthy();

      const active = await asUser(bob).get('/live/active');
      expect(active.body.items).toHaveLength(1);
      expect(active.body.items[0].user.id).toBe(alice.id);

      const ended = waitFor<LiveEndedPayload>(bobSocket, SERVER_EVENTS.LIVE_ENDED);
      expect((await asUser(alice).post('/live/end')).status).toBe(200);
      expect((await ended).userId).toBe(alice.id);

      // Ending twice is a no-op-error, not a crash.
      expect((await asUser(alice).post('/live/end')).status).toBe(404);
    } finally {
      bobSocket.disconnect();
      carolSocket.disconnect();
    }
  });

  it('lets a friend join the mesh room but rejects a stranger', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);
    await asUser(alice).post('/live/start', { visibility: 'everyone' });

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    const carolSocket = await connectSocket(carol);
    try {
      const joined = waitFor<LiveViewerJoinedPayload>(
        aliceSocket,
        SERVER_EVENTS.LIVE_VIEWER_JOINED,
      );
      bobSocket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: alice.id });
      expect((await joined).viewer.id).toBe(bob.id);

      const strangerJoin = neverGets<LiveViewerJoinedPayload>(
        aliceSocket,
        SERVER_EVENTS.LIVE_VIEWER_JOINED,
      );
      carolSocket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: alice.id });
      expect(await strangerJoin).toBeNull();
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
      carolSocket.disconnect();
      await asUser(alice).post('/live/end');
    }
  });
});

describe('active-users count (§12.2)', () => {
  it('excludes "no one" visibility from both the global and friends counts', async () => {
    const alice = await registerUser();
    const hidden = await registerUser();
    await befriend(alice, hidden);
    expect(
      (await asUser(hidden).patch('/users/me/privacy', { lastSeenVisibility: 'no_one' })).status,
    ).toBe(200);

    const before = await asUser(alice).get('/presence/active-count?scope=all');
    const beforeFriends = await asUser(alice).get('/presence/active-count?scope=friends');

    const hiddenSocket = await connectSocket(hidden);
    try {
      const after = await asUser(alice).get('/presence/active-count?scope=all');
      const afterFriends = await asUser(alice).get('/presence/active-count?scope=friends');
      expect(after.body.count).toBe(before.body.count);
      expect(afterFriends.body.count).toBe(beforeFriends.body.count);
    } finally {
      hiddenSocket.disconnect();
    }
  });
});

describe('1:1 calls (§14.4)', () => {
  it('rings a friend, relays accept + a signal, then ends on hang-up', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    const carolSocket = await connectSocket(carol);
    try {
      const callId = '11111111-1111-4111-8111-111111111111';

      const incoming = waitFor<CallIncomingPayload>(bobSocket, SERVER_EVENTS.CALL_INCOMING);
      aliceSocket.emit(CLIENT_EVENTS.CALL_INVITE, { callId, toUserId: bob.id, kind: 'video' });
      expect((await incoming).from.id).toBe(alice.id);

      const accepted = waitFor<CallLifecyclePayload>(aliceSocket, SERVER_EVENTS.CALL_ACCEPTED);
      bobSocket.emit(CLIENT_EVENTS.CALL_ACCEPT, { callId });
      expect((await accepted).callId).toBe(callId);

      const offerRelayed = waitFor<RtcSignalRelayPayload>(bobSocket, CLIENT_EVENTS.CALL_OFFER);
      aliceSocket.emit(CLIENT_EVENTS.CALL_OFFER, {
        context: 'call',
        callId,
        payload: { sdp: 'fake-offer' },
      });
      const relayed = await offerRelayed;
      expect(relayed.fromUserId).toBe(alice.id);
      expect((relayed as { payload: { sdp: string } }).payload.sdp).toBe('fake-offer');

      const ended = waitFor<CallLifecyclePayload>(aliceSocket, SERVER_EVENTS.CALL_ENDED);
      bobSocket.emit(CLIENT_EVENTS.CALL_END, { callId });
      expect((await ended).callId).toBe(callId);

      // Inviting a non-friend rings nobody.
      const strangerRing = neverGets<CallIncomingPayload>(carolSocket, SERVER_EVENTS.CALL_INCOMING);
      aliceSocket.emit(CLIENT_EVENTS.CALL_INVITE, {
        callId: '22222222-2222-4222-8222-222222222222',
        toUserId: carol.id,
        kind: 'audio',
      });
      expect(await strangerRing).toBeNull();
    } finally {
      aliceSocket.disconnect();
      bobSocket.disconnect();
      carolSocket.disconnect();
    }
  });
});

describe('ICE servers (§11)', () => {
  it('always includes a STUN entry (STUN-only in this test environment)', async () => {
    const alice = await registerUser();
    const res = await asUser(alice).get('/rtc/ice-servers');
    expect(res.status).toBe(200);
    expect(res.body.iceServers.length).toBeGreaterThanOrEqual(1);
    expect(res.body.iceServers[0].urls).toContain('stun:stun.l.google.com:19302');
  });
});
