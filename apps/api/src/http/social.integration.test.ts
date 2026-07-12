import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { LIMITS } from '@pulsechat/shared';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';

/**
 * M2 social graph integration tests (Requirement Scope §9–10): search,
 * friend requests, suggestions, blocking, invites, and public profiles.
 */

const app = createApp();

let counter = 0;
function uname(prefix = 'soc'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`.slice(0, 18);
}

const PUBLIC_KEY = 'A'.repeat(43) + '=';
const PASSWORD = 'correct-horse-9';

interface TestUser {
  id: string;
  username: string;
  token: string;
}

/** Full registration through the API — the actor users of each scenario. */
async function registerUser(
  overrides: { username?: string; displayName?: string; inviteCode?: string } = {},
): Promise<TestUser> {
  const username = overrides.username ?? uname();
  const res = await request(app)
    .post('/auth/register')
    .send({
      username,
      displayName: overrides.displayName ?? 'Social Tester',
      password: PASSWORD,
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: `fingerprint-${username}`,
      ...(overrides.inviteCode ? { inviteCode: overrides.inviteCode } : {}),
    });
  expect(res.status).toBe(201);
  return { id: res.body.user.id, username, token: res.body.accessToken };
}

/** Fast path for extras that only need to exist (skips Argon2 hashing). */
async function seedUser(overrides: { displayName?: string } = {}): Promise<{
  id: string;
  username: string;
}> {
  const username = uname('sd');
  const user = await prisma.user.create({
    data: {
      username,
      displayName: overrides.displayName ?? 'Seeded User',
      passwordHash: 'not-a-real-hash',
      publicKey: PUBLIC_KEY,
      privacy: { create: {} },
    },
  });
  return { id: user.id, username };
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
  const accepted = await asUser(b).patch(`/friend-requests/${sent.body.id}`, {
    action: 'accept',
  });
  expect(accepted.status).toBe(200);
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /search/users', () => {
  it('matches username and display name, excluding the searcher', async () => {
    const marker = uname('mk');
    const alice = await registerUser({ displayName: `Findme ${marker}` });
    const bob = await registerUser({ displayName: `Findme ${marker}` });

    const byDisplay = await asUser(alice).get(`/search/users?q=${marker}`);
    expect(byDisplay.status).toBe(200);
    const ids = byDisplay.body.items.map((u: { id: string }) => u.id);
    expect(ids).toContain(bob.id);
    expect(ids).not.toContain(alice.id);

    const byUsername = await asUser(alice).get(`/search/users?q=${bob.username}`);
    expect(byUsername.body.items.map((u: { id: string }) => u.id)).toContain(bob.id);
  });

  it('reports the relationship and privacy gate per result', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await asUser(carol).patch('/users/me/privacy', { whoCanSendRequests: 'private' });

    await asUser(alice).post('/friend-requests', { toUserId: bob.id });

    const bobResult = await asUser(alice).get(`/search/users?q=${bob.username}`);
    expect(bobResult.body.items[0].relationship).toBe('outgoing_pending');
    expect(bobResult.body.items[0].requestId).toBeTruthy();

    const fromBob = await asUser(bob).get(`/search/users?q=${alice.username}`);
    expect(fromBob.body.items[0].relationship).toBe('incoming_pending');

    const carolResult = await asUser(alice).get(`/search/users?q=${carol.username}`);
    expect(carolResult.body.items[0].relationship).toBe('none');
    expect(carolResult.body.items[0].canSendRequest).toBe(false);
  });

  it('paginates with a cursor', async () => {
    const marker = uname('pg');
    const viewer = await registerUser();
    await Promise.all([
      seedUser({ displayName: `Page ${marker}` }),
      seedUser({ displayName: `Page ${marker}` }),
      seedUser({ displayName: `Page ${marker}` }),
    ]);

    const first = await asUser(viewer).get(`/search/users?q=${marker}&limit=2`);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await asUser(viewer).get(
      `/search/users?q=${marker}&limit=2&cursor=${first.body.nextCursor}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeUndefined();
  });

  it('rejects an empty query', async () => {
    const viewer = await registerUser();
    const res = await asUser(viewer).get('/search/users?q=');
    expect(res.status).toBe(400);
  });
});

describe('friend requests', () => {
  it('runs the full send → accept flow and creates the friendship', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    const sent = await asUser(alice).post('/friend-requests', { toUserId: bob.id });
    expect(sent.status).toBe(201);

    const incoming = await asUser(bob).get('/friend-requests?direction=incoming');
    expect(incoming.body.items).toHaveLength(1);
    expect(incoming.body.items[0].user.id).toBe(alice.id);

    const outgoing = await asUser(alice).get('/friend-requests?direction=outgoing');
    expect(outgoing.body.items[0].user.id).toBe(bob.id);

    await asUser(bob).patch(`/friend-requests/${sent.body.id}`, { action: 'accept' });

    const aliceFriends = await asUser(alice).get('/friends');
    expect(aliceFriends.body.items.map((f: { user: { id: string } }) => f.user.id)).toContain(
      bob.id,
    );
    const bobFriends = await asUser(bob).get('/friends');
    expect(bobFriends.body.items.map((f: { user: { id: string } }) => f.user.id)).toContain(
      alice.id,
    );

    // The recipient got a friend_request notification, the sender a friend_accept.
    const bobNotifications = await prisma.notification.findMany({
      where: { userId: bob.id, type: 'friend_request' },
    });
    expect(bobNotifications).toHaveLength(1);
    const aliceNotifications = await prisma.notification.findMany({
      where: { userId: alice.id, type: 'friend_accept' },
    });
    expect(aliceNotifications).toHaveLength(1);
  });

  it('rejects duplicates, reverse duplicates, self and friend targets', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    const self = await asUser(alice).post('/friend-requests', { toUserId: alice.id });
    expect(self.status).toBe(400);

    await asUser(alice).post('/friend-requests', { toUserId: bob.id });
    const dupe = await asUser(alice).post('/friend-requests', { toUserId: bob.id });
    expect(dupe.status).toBe(409);
    const reverse = await asUser(bob).post('/friend-requests', { toUserId: alice.id });
    expect(reverse.status).toBe(409);
  });

  it('lets only the recipient accept/reject and only the sender cancel', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const mallory = await registerUser();

    const sent = await asUser(alice).post('/friend-requests', { toUserId: bob.id });
    const id = sent.body.id as string;

    expect((await asUser(alice).patch(`/friend-requests/${id}`, { action: 'accept' })).status).toBe(
      403,
    );
    expect((await asUser(bob).patch(`/friend-requests/${id}`, { action: 'cancel' })).status).toBe(
      403,
    );
    // A stranger cannot even see the request.
    expect(
      (await asUser(mallory).patch(`/friend-requests/${id}`, { action: 'accept' })).status,
    ).toBe(404);

    expect((await asUser(alice).patch(`/friend-requests/${id}`, { action: 'cancel' })).status).toBe(
      200,
    );
    // Already resolved — a second action conflicts.
    expect((await asUser(bob).patch(`/friend-requests/${id}`, { action: 'accept' })).status).toBe(
      409,
    );
    // After cancellation a fresh request is allowed again.
    expect((await asUser(alice).post('/friend-requests', { toUserId: bob.id })).status).toBe(201);
  });

  it('honours the who-can-send-requests privacy setting', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await asUser(carol).patch('/users/me/privacy', { whoCanSendRequests: 'friends' });

    // No mutual friends yet → forbidden.
    expect((await asUser(alice).post('/friend-requests', { toUserId: carol.id })).status).toBe(403);

    // Once alice and carol share bob as a friend, it is allowed. Carol must
    // initiate her own friendships — her setting blocks inbound, not outbound.
    await befriend(alice, bob);
    await befriend(carol, bob);
    expect((await asUser(alice).post('/friend-requests', { toUserId: carol.id })).status).toBe(201);
  });

  it(`caps pending outgoing requests at ${LIMITS.MAX_PENDING_FRIEND_REQUESTS}`, async () => {
    const alice = await registerUser();
    const targets = await Promise.all(
      Array.from({ length: LIMITS.MAX_PENDING_FRIEND_REQUESTS }, () => seedUser()),
    );
    await prisma.friendRequest.createMany({
      data: targets.map((t) => ({ fromUserId: alice.id, toUserId: t.id })),
    });

    const oneMore = await seedUser();
    const res = await asUser(alice).post('/friend-requests', { toUserId: oneMore.id });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/pending/i);
  });
});

describe('friends list & removal', () => {
  it('removes a friendship from either side', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);

    expect((await asUser(bob).delete(`/friends/${alice.id}`)).status).toBe(200);
    const friends = await asUser(alice).get('/friends');
    expect(friends.body.items).toHaveLength(0);
    // Removing twice is a 404.
    expect((await asUser(bob).delete(`/friends/${alice.id}`)).status).toBe(404);
  });
});

describe('suggestions (people you may know)', () => {
  it('suggests friends of friends ranked by mutual count', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    const dave = await registerUser();

    // alice–bob, alice–carol; bob–dave, carol–dave → dave has 2 mutuals with alice.
    await befriend(alice, bob);
    await befriend(alice, carol);
    await befriend(bob, dave);
    await befriend(carol, dave);

    const res = await asUser(alice).get('/friends/suggestions');
    expect(res.status).toBe(200);
    const dave2 = res.body.items.find((s: { user: { id: string } }) => s.user.id === dave.id);
    expect(dave2).toBeTruthy();
    expect(dave2.mutualCount).toBe(2);

    // A pending request removes the suggestion.
    await asUser(alice).post('/friend-requests', { toUserId: dave.id });
    const after = await asUser(alice).get('/friends/suggestions');
    expect(
      after.body.items.find((s: { user: { id: string } }) => s.user.id === dave.id),
    ).toBeUndefined();
  });
});

describe('blocking (§10.2)', () => {
  it('cancels pending requests and hides both users from each other in search', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await asUser(bob).post('/friend-requests', { toUserId: alice.id });

    expect((await asUser(alice).post('/blocks', { userId: bob.id })).status).toBe(201);

    // The pending request between them died with the block.
    const incoming = await asUser(alice).get('/friend-requests?direction=incoming');
    expect(incoming.body.items).toHaveLength(0);

    // Neither side finds the other in search.
    const bobSearches = await asUser(bob).get(`/search/users?q=${alice.username}`);
    expect(bobSearches.body.items).toHaveLength(0);
    const aliceSearches = await asUser(alice).get(`/search/users?q=${bob.username}`);
    expect(aliceSearches.body.items).toHaveLength(0);
  });

  it('blocks profile access and friend requests from the blocked side', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await asUser(alice).post('/blocks', { userId: bob.id });

    // B cannot view A's profile even though A is public (§10.2).
    expect((await asUser(bob).get(`/users/${alice.username}`)).status).toBe(404);
    // B's request attempt reads as "user not found" — A stays untraceable.
    expect((await asUser(bob).post('/friend-requests', { toUserId: alice.id })).status).toBe(404);
    // A must unblock before sending a request themselves.
    expect((await asUser(alice).post('/friend-requests', { toUserId: bob.id })).status).toBe(409);
  });

  it('hides a blocked friend from friends lists without destroying the friendship', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await befriend(alice, bob);
    await asUser(alice).post('/blocks', { userId: bob.id });

    expect((await asUser(alice).get('/friends')).body.items).toHaveLength(0);
    expect((await asUser(bob).get('/friends')).body.items).toHaveLength(0);

    // Unblocking restores normal visibility/interaction rules (§10.2).
    expect((await asUser(alice).delete(`/blocks/${bob.id}`)).status).toBe(200);
    const restored = await asUser(alice).get('/friends');
    expect(restored.body.items.map((f: { user: { id: string } }) => f.user.id)).toContain(bob.id);
  });

  it('lists blocked users and rejects unblocking a non-blocked user', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await asUser(alice).post('/blocks', { userId: bob.id });

    const list = await asUser(alice).get('/blocks');
    expect(list.body.items.map((b: { user: { id: string } }) => b.user.id)).toContain(bob.id);

    await asUser(alice).delete(`/blocks/${bob.id}`);
    expect((await asUser(alice).delete(`/blocks/${bob.id}`)).status).toBe(404);
  });
});

describe('invites (§10.3)', () => {
  it('returns a stable personal code and resolves it publicly', async () => {
    const alice = await registerUser();
    const first = await asUser(alice).post('/invites');
    const second = await asUser(alice).post('/invites');
    expect(first.body.code).toBeTruthy();
    expect(second.body.code).toBe(first.body.code);

    // Lookup needs no auth — it powers the guest landing page.
    const lookup = await request(app).get(`/invites/${first.body.code}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.inviter.id).toBe(alice.id);

    expect((await request(app).get('/invites/not-a-real-code')).status).toBe(404);
  });

  it('links a signup through an invite to the inviter with a friend request', async () => {
    const alice = await registerUser();
    const invite = await asUser(alice).post('/invites');

    const newcomer = await registerUser({ inviteCode: invite.body.code });

    const incoming = await asUser(alice).get('/friend-requests?direction=incoming');
    expect(incoming.body.items.map((r: { user: { id: string } }) => r.user.id)).toContain(
      newcomer.id,
    );
  });

  it('never fails a signup over a bad invite code', async () => {
    const newcomer = await registerUser({ inviteCode: 'definitely-not-real' });
    expect(newcomer.id).toBeTruthy();
  });
});

describe('GET /users/:username (public profile)', () => {
  it('shows the Instagram-style stat triple: posts, friends, pending sent (§13.4)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    await asUser(alice).post('/friend-requests', { toUserId: bob.id });

    const res = await asUser(alice).get(`/users/${alice.username}`);
    expect(res.status).toBe(200);
    expect(res.body.relationship).toBe('self');
    expect(res.body.details).toBeTruthy();
    expect(res.body.stats).toEqual({ posts: 0, friends: 0, pendingSent: 1 });
  });

  it('applies the three visibility levels (§8)', async () => {
    const stranger = await registerUser();
    const publicUser = await registerUser();
    const friendsUser = await registerUser();
    const privateUser = await registerUser();
    await asUser(friendsUser).patch('/users/me', { visibility: 'friends', bio: 'friends bio' });
    await asUser(privateUser).patch('/users/me', { visibility: 'private', bio: 'private bio' });
    await asUser(publicUser).patch('/users/me', { bio: 'public bio' });

    const seesPublic = await asUser(stranger).get(`/users/${publicUser.username}`);
    expect(seesPublic.body.details.bio).toBe('public bio');
    expect(seesPublic.body.stats).toBeTruthy();

    // Friends-only and private profiles show just the minimal card to strangers.
    for (const target of [friendsUser, privateUser]) {
      const seen = await asUser(stranger).get(`/users/${target.username}`);
      expect(seen.status).toBe(200);
      expect(seen.body.details).toBeNull();
      expect(seen.body.stats).toBeNull();
      expect(seen.body.user.username).toBe(target.username);
    }

    // Once friends, the details open up.
    await befriend(stranger, friendsUser);
    const asFriend = await asUser(stranger).get(`/users/${friendsUser.username}`);
    expect(asFriend.body.details.bio).toBe('friends bio');
    expect(asFriend.body.relationship).toBe('friends');
  });

  it('hides email and birth date unless the owner opted in', async () => {
    const viewer = await registerUser();
    const owner = await registerUser();
    await asUser(owner).patch('/users/me', { birthDate: '2000-05-05' });

    const hidden = await asUser(viewer).get(`/users/${owner.username}`);
    expect(hidden.body.details.birthDate).toBeNull();

    await asUser(owner).patch('/users/me/privacy', { birthdateVisible: true });
    const shown = await asUser(viewer).get(`/users/${owner.username}`);
    expect(shown.body.details.birthDate).toBe('2000-05-05');
  });

  it('counts mutual friends for other profiles', async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const carol = await registerUser();
    await befriend(alice, bob);
    await befriend(carol, bob);

    const res = await asUser(alice).get(`/users/${carol.username}`);
    expect(res.body.mutualCount).toBe(1);
  });

  it('404s for unknown users', async () => {
    const viewer = await registerUser();
    expect((await asUser(viewer).get('/users/nosuchuser404')).status).toBe(404);
  });

  it('reflects a new post and a new friendship on the very next stat read (M8 caching)', async () => {
    const alice = await registerUser();
    const bob = await registerUser();

    // First read populates the profile-counts cache at {posts: 0, friends: 0}.
    const before = await asUser(alice).get(`/users/${alice.username}`);
    expect(before.body.stats).toMatchObject({ posts: 0, friends: 0 });

    await asUser(alice).post('/posts', {
      mediaUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    });
    const afterPost = await asUser(alice).get(`/users/${alice.username}`);
    expect(afterPost.body.stats.posts).toBe(1);

    await befriend(alice, bob);
    const afterFriend = await asUser(alice).get(`/users/${alice.username}`);
    expect(afterFriend.body.stats.friends).toBe(1);
  });
});
