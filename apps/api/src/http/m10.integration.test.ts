import { createServer, type Server as HttpServer } from 'node:http';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type LiveCommentPayload,
  type LiveViewerLeftPayload,
  type LiveViewersSnapshotPayload,
} from '@pulsechat/shared';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';
import { setIo } from '../lib/io.js';
import { attachSockets } from '../sockets/index.js';

/**
 * M10 integration tests (Requirement §6.2, §24.10–§24.15): remember-me
 * session hardening (session-only vs. 30-day tokens, reused-token
 * revocation, step-up re-auth), close friends, story reactions/polls, and
 * live viewer list + comments.
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
  return `m10${Date.now().toString(36)}${counter}`.slice(0, 18);
}
function fp(label = 'a'): string {
  return `test-fingerprint-${label}-${counter}`;
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
      displayName: 'M10 Tester',
      password: PASSWORD,
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: fp(username),
    });
  expect(res.status).toBe(201);
  return { id: res.body.user.id, username, token: res.body.accessToken };
}

function asUser(user: TestUser) {
  return {
    get: (path: string) => request(app).get(path).set('Authorization', `Bearer ${user.token}`),
    post: (path: string, body?: object) =>
      request(app).post(path).set('Authorization', `Bearer ${user.token}`).send(body),
    delete: (path: string) =>
      request(app).delete(path).set('Authorization', `Bearer ${user.token}`),
  };
}

async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const sent = await asUser(a).post('/friend-requests', { toUserId: b.id });
  expect(sent.status).toBe(201);
  const accepted = await request(app)
    .patch(`/friend-requests/${sent.body.id}`)
    .set('Authorization', `Bearer ${b.token}`)
    .send({ action: 'accept' });
  expect(accepted.status).toBe(200);
}

function rawCookieHeader(res: request.Response): string {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cookies?.find((c) => c.startsWith('pc_refresh='));
  expect(cookie, 'expected a pc_refresh cookie').toBeTruthy();
  return cookie!;
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

function neverGets<T>(socket: ClientSocket, event: string, timeoutMs = 400): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('remember me (§6.2)', () => {
  it('issues a browser-session cookie when rememberMe is false, a 30-day cookie when true', async () => {
    const username = uname();
    await request(app)
      .post('/auth/register')
      .send({
        username,
        displayName: 'Remember Me',
        password: PASSWORD,
        consent: true,
        publicKey: PUBLIC_KEY,
        deviceFingerprint: fp('reg'),
      });

    const sessionOnly = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('session'), rememberMe: false });
    expect(sessionOnly.status).toBe(200);
    expect(rawCookieHeader(sessionOnly)).not.toMatch(/Max-Age/i);

    const remembered = await request(app)
      .post('/auth/login')
      .send({ username, password: PASSWORD, deviceFingerprint: fp('remember'), rememberMe: true });
    expect(remembered.status).toBe(200);
    expect(rawCookieHeader(remembered)).toMatch(/Max-Age/i);
  });

  it('detects a replayed (already-rotated-away) refresh token and revokes every session', async () => {
    const username = uname();
    const register = await request(app)
      .post('/auth/register')
      .send({
        username,
        displayName: 'Reuse Detect',
        password: PASSWORD,
        consent: true,
        publicKey: PUBLIC_KEY,
        deviceFingerprint: fp('reg2'),
      });
    const originalCookie = rawCookieHeader(register);

    // Rotate once — the original token is now "previous", not current.
    const refreshed = await request(app).post('/auth/refresh').set('Cookie', originalCookie);
    expect(refreshed.status).toBe(200);
    const rotatedCookie = rawCookieHeader(refreshed);

    // Outside the reuse-detection grace window (it exists so two genuinely
    // concurrent requests for the same pre-rotation token — the CAS race —
    // don't get misclassified as theft); back-date directly rather than
    // sleeping the test past it.
    const owner = await prisma.user.findUniqueOrThrow({ where: { username } });
    await prisma.device.updateMany({
      where: { userId: owner.id },
      data: { lastSeenAt: new Date(Date.now() - 60_000) },
    });

    // Replaying the original (already-rotated-away) token is theft-shaped —
    // every session for this user should be revoked as a result.
    const replay = await request(app).post('/auth/refresh').set('Cookie', originalCookie);
    expect(replay.status).toBe(401);

    const rotatedNowRevoked = await request(app).post('/auth/refresh').set('Cookie', rotatedCookie);
    expect(rotatedNowRevoked.status).toBe(401);

    const audit = await prisma.auditLogEntry.findMany({
      where: { eventType: 'refresh_token_reuse_detected' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(audit).toHaveLength(1);
  });
});

describe('close friends (§24.12)', () => {
  it('only accepts actual friends, and gates close_friends-visibility statuses on the list', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    const stranger = await registerUser();
    await befriend(alice, bob);
    await befriend(alice, carol);

    const rejected = await asUser(alice).post(`/close-friends/${stranger.id}`);
    expect(rejected.status).toBe(404);

    const added = await asUser(alice).post(`/close-friends/${bob.id}`);
    expect(added.status).toBe(201);

    const list = await asUser(alice).get('/close-friends');
    expect(list.body.items.map((i: { user: { id: string } }) => i.user.id)).toEqual([bob.id]);

    const status = await asUser(alice).post('/statuses', {
      caption: 'inner circle only',
      visibility: 'close_friends',
    });
    expect(status.status).toBe(201);

    const bobFeed = await asUser(bob).get('/statuses/feed');
    expect(
      bobFeed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeTruthy();

    const carolFeed = await asUser(carol).get('/statuses/feed');
    expect(
      carolFeed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeUndefined();

    const removed = await asUser(alice).delete(`/close-friends/${bob.id}`);
    expect(removed.status).toBe(200);
    const bobFeedAfter = await asUser(bob).get('/statuses/feed');
    expect(
      bobFeedAfter.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id),
    ).toBeUndefined();
  });
});

describe('story reactions (§24.10)', () => {
  it('toggles a reaction, counts it, and notifies the author (never on self-react)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);

    const status = await asUser(alice).post('/statuses', {
      caption: 'react to this',
      visibility: 'everyone',
    });
    const statusId = status.body.status.id as string;

    const reacted = await asUser(bob).post(`/statuses/${statusId}/react`, { emoji: '🔥' });
    expect(reacted.body).toEqual({ emoji: '🔥' });

    const feed = await asUser(alice).get('/statuses/feed');
    const entry = feed.body.items.find((e: { user: { id: string } }) => e.user.id === alice.id);
    expect(entry.statuses[0].reactionCount).toBe(1);

    const notifications = await prisma.notification.findMany({
      where: { userId: alice.id, type: 'story_reaction' },
    });
    expect(notifications.length).toBeGreaterThan(0);

    // Same emoji again removes it (toggle-off).
    const untoggled = await asUser(bob).post(`/statuses/${statusId}/react`, { emoji: '🔥' });
    expect(untoggled.body).toEqual({ emoji: null });
    const feedAfter = await asUser(alice).get('/statuses/feed');
    const entryAfter = feedAfter.body.items.find(
      (e: { user: { id: string } }) => e.user.id === alice.id,
    );
    expect(entryAfter.statuses[0].reactionCount).toBe(0);

    // Self-react never notifies.
    const before = notifications.length;
    await asUser(alice).post(`/statuses/${statusId}/react`, { emoji: '👍' });
    const afterSelf = await prisma.notification.findMany({
      where: { userId: alice.id, type: 'story_reaction' },
    });
    expect(afterSelf.length).toBe(before);
  });
});

describe('story polls/questions (§24.13)', () => {
  it('collects poll votes and keeps results author-only', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const stranger = await registerUser();
    await befriend(alice, bob);

    const created = await asUser(alice).post('/statuses', {
      caption: 'pick one',
      visibility: 'everyone',
      poll: {
        kind: 'poll',
        question: 'Cats or dogs?',
        options: [
          { id: 'cats', label: 'Cats' },
          { id: 'dogs', label: 'Dogs' },
        ],
      },
    });
    expect(created.status).toBe(201);
    const statusId = created.body.status.id as string;
    expect(created.body.status.poll.question).toBe('Cats or dogs?');

    const badVote = await asUser(bob).post(`/statuses/${statusId}/poll/respond`, {
      selectedOptionId: 'not-an-option',
    });
    expect(badVote.status).toBe(400);

    const vote = await asUser(bob).post(`/statuses/${statusId}/poll/respond`, {
      selectedOptionId: 'cats',
    });
    expect(vote.status).toBe(200);

    const nonAuthorResults = await asUser(bob).get(`/statuses/${statusId}/poll/results`);
    expect(nonAuthorResults.status).toBe(403);

    const results = await asUser(alice).get(`/statuses/${statusId}/poll/results`);
    expect(results.status).toBe(200);
    expect(results.body.kind).toBe('poll');
    expect(results.body.totalResponses).toBe(1);
    expect(results.body.options.find((o: { id: string }) => o.id === 'cats').count).toBe(1);

    // A stranger can't view or vote on a status they can't see.
    const strangerVote = await asUser(stranger).post(`/statuses/${statusId}/poll/respond`, {
      selectedOptionId: 'dogs',
    });
    expect(strangerVote.status).toBe(404);
  });

  it('collects free-text answers for a question sticker', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);

    const created = await asUser(alice).post('/statuses', {
      caption: 'ask me anything',
      visibility: 'everyone',
      poll: { kind: 'question', question: 'Favorite food?' },
    });
    const statusId = created.body.status.id as string;

    const answered = await asUser(bob).post(`/statuses/${statusId}/poll/respond`, {
      answerText: 'Pizza',
    });
    expect(answered.status).toBe(200);

    const results = await asUser(alice).get(`/statuses/${statusId}/poll/results`);
    expect(results.body.kind).toBe('question');
    expect(results.body.answers).toEqual([
      expect.objectContaining({
        answerText: 'Pizza',
        user: expect.objectContaining({ id: bob.id }),
      }),
    ]);

    const notifications = await prisma.notification.findMany({
      where: { userId: alice.id, type: 'story_poll_response' },
    });
    expect(notifications.length).toBeGreaterThan(0);
  });
});

describe('live viewer list + comments (§24.15)', () => {
  it('snapshots current viewers on join, fans out comments, replays history, and cleans up on disconnect', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const dave = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);
    await befriend(alice, dave);
    expect((await asUser(alice).post('/live/start', { visibility: 'everyone' })).status).toBe(201);

    const aliceSocket = await connectSocket(alice);
    const bobSocket = await connectSocket(bob);
    const carolSocket = await connectSocket(carol);
    try {
      aliceSocket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: alice.id });
      await waitFor<LiveViewersSnapshotPayload>(aliceSocket, SERVER_EVENTS.LIVE_VIEWERS_SNAPSHOT);

      const bobSnapshot = waitFor<LiveViewersSnapshotPayload>(
        bobSocket,
        SERVER_EVENTS.LIVE_VIEWERS_SNAPSHOT,
      );
      bobSocket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: alice.id });
      const snapshot = await bobSnapshot;
      expect(snapshot.viewers.map((v) => v.id)).toContain(bob.id);

      // A stranger can't join, so they never see a snapshot or comments.
      const carolNever = neverGets<LiveViewersSnapshotPayload>(
        carolSocket,
        SERVER_EVENTS.LIVE_VIEWERS_SNAPSHOT,
      );
      carolSocket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: alice.id });
      expect(await carolNever).toBeNull();

      // A comment fans out to everyone in the live room, including the broadcaster.
      const aliceGetsComment = waitFor<LiveCommentPayload>(aliceSocket, SERVER_EVENTS.LIVE_COMMENT);
      bobSocket.emit(CLIENT_EVENTS.LIVE_COMMENT, {
        broadcasterUserId: alice.id,
        text: 'hi alice!',
      });
      const commentEvent = await aliceGetsComment;
      expect(commentEvent.comment.text).toBe('hi alice!');
      expect(commentEvent.comment.user.id).toBe(bob.id);

      // A stranger's comment reaches no one.
      const aliceNeverGetsStrangerComment = neverGets<LiveCommentPayload>(
        aliceSocket,
        SERVER_EVENTS.LIVE_COMMENT,
      );
      carolSocket.emit(CLIENT_EVENTS.LIVE_COMMENT, {
        broadcasterUserId: alice.id,
        text: 'sneaky',
      });
      expect(await aliceNeverGetsStrangerComment).toBeNull();

      // A later joiner replays recent comment history.
      const daveSocket = await connectSocket(dave);
      const daveLeft = waitFor<LiveViewerLeftPayload>(aliceSocket, SERVER_EVENTS.LIVE_VIEWER_LEFT);
      try {
        const replay = waitFor<LiveCommentPayload>(daveSocket, SERVER_EVENTS.LIVE_COMMENT);
        daveSocket.emit(CLIENT_EVENTS.LIVE_JOIN, { broadcasterUserId: alice.id });
        expect((await replay).comment.text).toBe('hi alice!');
      } finally {
        daveSocket.disconnect();
      }
      // Wait for dave's own disconnect to be processed before asserting bob's,
      // so the two async disconnect-driven events can't race each other.
      expect((await daveLeft).viewerId).toBe(dave.id);

      // Disconnecting (without an explicit live:leave) still drops the viewer.
      const bobLeft = waitFor<LiveViewerLeftPayload>(aliceSocket, SERVER_EVENTS.LIVE_VIEWER_LEFT);
      bobSocket.disconnect();
      expect((await bobLeft).viewerId).toBe(bob.id);
    } finally {
      aliceSocket.disconnect();
      carolSocket.disconnect();
      await asUser(alice).post('/live/end');
    }
  });
});
