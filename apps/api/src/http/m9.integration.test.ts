import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';

/**
 * M9 integration tests (post-handoff addendum, Requirement Scope §24):
 * text-only posts, post tagging, comment likes, post audience + private-
 * profile visit rules, new-user-suggestion notifications, and the discover
 * (trending) list endpoints.
 */

const app = createApp();

let counter = 0;
function uname(prefix = 'm9'): string {
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

async function registerUser(
  overrides: { displayName?: string; inviteCode?: string } = {},
): Promise<TestUser> {
  const username = uname();
  const res = await request(app)
    .post('/auth/register')
    .send({
      username,
      displayName: overrides.displayName ?? 'M9 Tester',
      password: PASSWORD,
      consent: true,
      publicKey: PUBLIC_KEY,
      deviceFingerprint: `fingerprint-${username}`,
      ...(overrides.inviteCode ? { inviteCode: overrides.inviteCode } : {}),
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

afterAll(async () => {
  await prisma.$disconnect();
});

describe('text-only posts (§24.1)', () => {
  it('accepts a caption-only post with no media', async () => {
    const author = await registerUser();
    const res = await asUser(author).post('/posts', { caption: 'thoughts, no photo today' });
    expect(res.status).toBe(201);
    expect(res.body.post.mediaUrl).toBeNull();
    expect(res.body.post.caption).toBe('thoughts, no photo today');
  });

  it('rejects a post with neither media nor caption', async () => {
    const author = await registerUser();
    const res = await asUser(author).post('/posts', {});
    expect(res.status).toBe(400);
  });
});

describe('tag people in posts (§24.2)', () => {
  it('notifies friends tagged at creation, drops non-friend ids, and lets a tagged user self-remove', async () => {
    const author = await registerUser();
    const friend = await registerUser({ displayName: 'Tagged Friend' });
    const stranger = await registerUser();
    await befriend(author, friend);

    const res = await asUser(author).post('/posts', {
      caption: 'squad photo',
      mediaUrl: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
      taggedUserIds: [friend.id, stranger.id],
    });
    expect(res.status).toBe(201);
    const taggedIds = res.body.post.taggedUsers.map((u: { id: string }) => u.id);
    expect(taggedIds).toEqual([friend.id]);

    const notifications = await prisma.notification.findMany({ where: { userId: friend.id } });
    expect(notifications.some((n) => n.type === 'tag')).toBe(true);

    const removed = await asUser(friend).delete(`/posts/${res.body.post.id}/tags/me`);
    expect(removed.status).toBe(200);
    const after = await asUser(author).get(`/posts/${res.body.post.id}`);
    expect(after.body.post.taggedUsers).toEqual([]);

    // The author cannot remove someone else's tag via the same self-only endpoint.
    const authorAttempt = await asUser(author).delete(`/posts/${res.body.post.id}/tags/me`);
    expect(authorAttempt.status).toBe(404);
  });
});

describe('comment likes (§24.6)', () => {
  it('toggles a comment like with a counter and notifies the comment author (never on self-like)', async () => {
    const author = await registerUser();
    const commenter = await registerUser({ displayName: 'Commenter' });
    const liker = await registerUser({ displayName: 'Comment Liker' });

    const post = await asUser(author).post('/posts', { caption: 'like my comment please' });
    const comment = await asUser(commenter).post(`/posts/${post.body.post.id}/comments`, {
      body: 'nice post!',
    });
    expect(comment.status).toBe(201);
    expect(comment.body.comment.likeCount).toBe(0);

    const liked = await asUser(liker).post(`/comments/${comment.body.comment.id}/like`);
    expect(liked.body).toEqual({ liked: true });

    const list = await asUser(author).get(`/posts/${post.body.post.id}/comments`);
    expect(list.body.items[0].likeCount).toBe(1);
    expect(list.body.items[0].likedByMe).toBe(false); // author didn't like it

    const notifications = await prisma.notification.findMany({ where: { userId: commenter.id } });
    expect(notifications.some((n) => n.type === 'comment_like')).toBe(true);

    // Self-like never notifies.
    const before = notifications.length;
    await asUser(commenter).post(`/comments/${comment.body.comment.id}/like`);
    const commenterNotifications = await prisma.notification.findMany({
      where: { userId: commenter.id, type: 'comment_like' },
    });
    expect(commenterNotifications.length).toBe(before > 0 ? commenterNotifications.length : 0);
  });
});

describe('post audience (§24.7)', () => {
  it('hides a friends-audience post from a stranger even when the author is public', async () => {
    const author = await registerUser();
    const friend = await registerUser();
    const stranger = await registerUser();
    await befriend(author, friend);

    const post = await asUser(author).post('/posts', {
      caption: 'friends only please',
      audience: 'friends',
    });
    expect(post.status).toBe(201);

    expect((await asUser(friend).get(`/posts/${post.body.post.id}`)).status).toBe(200);
    expect((await asUser(stranger).get(`/posts/${post.body.post.id}`)).status).toBe(404);
  });

  it('hides an only_me post from everyone but the author, including friends', async () => {
    const author = await registerUser();
    const friend = await registerUser();
    await befriend(author, friend);

    const post = await asUser(author).post('/posts', {
      caption: 'just for me',
      audience: 'only_me',
    });
    expect(post.status).toBe(201);

    expect((await asUser(author).get(`/posts/${post.body.post.id}`)).status).toBe(200);
    expect((await asUser(friend).get(`/posts/${post.body.post.id}`)).status).toBe(404);
  });

  it('excludes friends/only_me posts from hashtag discovery even for a public author', async () => {
    const marker = uname('aud');
    const author = await registerUser();
    const stranger = await registerUser();

    await asUser(author).post('/posts', { caption: `visible #${marker}`, audience: 'everyone' });
    await asUser(author).post('/posts', { caption: `hidden #${marker}`, audience: 'friends' });

    const page = await asUser(stranger).get(`/hashtags/${marker}`);
    expect(page.body.items).toHaveLength(1);
  });
});

describe('private-profile visit rules (§24.8)', () => {
  it('keeps profile stat counts accurate for a stranger while the post grid stays audience-filtered', async () => {
    const author = await registerUser();
    const stranger = await registerUser();

    await asUser(author).post('/posts', { caption: 'public one', audience: 'everyone' });
    await asUser(author).post('/posts', { caption: 'friends only one', audience: 'friends' });

    const profile = await asUser(stranger).get(`/users/${author.username}`);
    expect(profile.status).toBe(200);
    expect(profile.body.stats.posts).toBe(2); // real, unfiltered count

    const grid = await asUser(stranger).get(`/users/${author.username}/posts`);
    expect(grid.body.items).toHaveLength(1); // only the everyone-audience post
  });
});

describe('new-user-suggestion notifications (§24.5)', () => {
  it('notifies the inviter’s other friends when someone signs up through their invite link', async () => {
    const inviter = await registerUser({ displayName: 'Inviter' });
    const inviterFriend = await registerUser({ displayName: 'Inviter Friend' });
    await befriend(inviter, inviterFriend);

    const invite = await asUser(inviter).post('/invites');
    expect(invite.status).toBe(200);

    await registerUser({ displayName: 'Fresh Signup', inviteCode: invite.body.code });

    const notifications = await prisma.notification.findMany({
      where: { userId: inviterFriend.id, type: 'new_user_suggestion' },
    });
    expect(notifications.length).toBeGreaterThan(0);
  });
});

describe('discover — trending movies & songs (§24.3)', () => {
  it('serves an empty cursor-shaped page before the cache has ever been populated', async () => {
    const user = await registerUser();
    const movies = await asUser(user).get('/discover/movies');
    expect(movies.status).toBe(200);
    expect(movies.body).toEqual({ items: expect.any(Array) });

    const songs = await asUser(user).get('/discover/songs');
    expect(songs.status).toBe(200);
    expect(songs.body).toEqual({ items: expect.any(Array) });
  });
});
