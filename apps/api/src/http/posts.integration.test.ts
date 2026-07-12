import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { prisma } from '../lib/prisma.js';

/**
 * M6 integration tests (Requirement Scope §13): posts, hashtags, ranking,
 * explore feed, likes/comments/saves, and visibility gating.
 */

const app = createApp();

let counter = 0;
function uname(prefix = 'pv'): string {
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

async function registerUser(overrides: { displayName?: string } = {}): Promise<TestUser> {
  const username = uname();
  const res = await request(app)
    .post('/auth/register')
    .send({
      username,
      displayName: overrides.displayName ?? 'Post Tester',
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

async function setVisibility(user: TestUser, visibility: 'public' | 'friends' | 'private') {
  const res = await asUser(user).patch('/users/me', { visibility });
  expect(res.status).toBe(200);
}

async function befriend(a: TestUser, b: TestUser): Promise<void> {
  const sent = await asUser(a).post('/friend-requests', { toUserId: b.id });
  expect(sent.status).toBe(201);
  const accepted = await asUser(b).patch(`/friend-requests/${sent.body.id}`, { action: 'accept' });
  expect(accepted.status).toBe(200);
}

async function createPost(user: TestUser, body: { caption?: string; mediaUrl?: string } = {}) {
  const res = await asUser(user).post('/posts', {
    mediaUrl: body.mediaUrl ?? 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    ...(body.caption ? { caption: body.caption } : {}),
  });
  expect(res.status).toBe(201);
  return res.body.post as { id: string; hashtags: string[]; likeCount: number };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('post creation & hashtags (§13.1, §13.3)', () => {
  it('indexes hashtags from the caption only for public-profile authors', async () => {
    const publicUser = await registerUser();
    const friendsUser = await registerUser();
    await setVisibility(friendsUser, 'friends');

    const publicPost = await createPost(publicUser, { caption: 'sunset vibes #Chill #sunset' });
    expect(publicPost.hashtags.sort()).toEqual(['chill', 'sunset']);

    const friendsPost = await createPost(friendsUser, { caption: 'private moment #chill' });
    expect(friendsPost.hashtags).toEqual([]);
  });
});

describe('post visibility (§13.3, reuses the profile visibility gate)', () => {
  it('shows a public author post to anyone, and a friends/private author post only to friends', async () => {
    for (const visibility of ['friends', 'private'] as const) {
      const author = await registerUser();
      await setVisibility(author, visibility);
      const friend = await registerUser();
      const stranger = await registerUser();
      await befriend(author, friend);

      const post = await createPost(author, { caption: 'hello' });

      expect((await asUser(friend).get(`/posts/${post.id}`)).status).toBe(200);
      expect((await asUser(stranger).get(`/posts/${post.id}`)).status).toBe(404);
    }
  });

  it('is visible to everyone when the author is public', async () => {
    const author = await registerUser();
    const stranger = await registerUser();
    const post = await createPost(author, { caption: 'public post' });
    expect((await asUser(stranger).get(`/posts/${post.id}`)).status).toBe(200);
  });
});

describe('likes, saves, comments (§13.5)', () => {
  it('toggles likes with a transactional counter and notifies the author', async () => {
    const author = await registerUser();
    const liker = await registerUser({ displayName: 'Liker Person' });
    const post = await createPost(author);

    const liked = await asUser(liker).post(`/posts/${post.id}/like`);
    expect(liked.body).toEqual({ liked: true });
    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.likeCount).toBe(1);

    const notifications = await prisma.notification.findMany({ where: { userId: author.id } });
    expect(notifications.some((n) => n.type === 'post_like')).toBe(true);

    const unliked = await asUser(liker).post(`/posts/${post.id}/like`);
    expect(unliked.body).toEqual({ liked: false });
    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.likeCount).toBe(0);
  });

  it('toggles saves privately without touching the like counter or notifying', async () => {
    const author = await registerUser();
    const saver = await registerUser();
    const post = await createPost(author);

    const saved = await asUser(saver).post(`/posts/${post.id}/save`);
    expect(saved.body).toEqual({ saved: true });
    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.likeCount).toBe(0);
    // Not visible to the author — savedByMe is per-viewer.
    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.savedByMe).toBe(false);
    expect((await asUser(saver).get(`/posts/${post.id}`)).body.post.savedByMe).toBe(true);

    const notifications = await prisma.notification.findMany({ where: { userId: author.id } });
    expect(notifications.some((n) => n.type === 'post_comment')).toBe(false);
  });

  it('adds comments chronologically with a live counter, and notifies the author', async () => {
    const author = await registerUser();
    const commenter = await registerUser({ displayName: 'Commenter Person' });
    const post = await createPost(author);

    const first = await asUser(commenter).post(`/posts/${post.id}/comments`, { body: 'first!' });
    expect(first.status).toBe(201);
    const second = await asUser(author).post(`/posts/${post.id}/comments`, { body: 'thanks!' });
    expect(second.status).toBe(201);

    const list = await asUser(author).get(`/posts/${post.id}/comments`);
    expect(list.body.items.map((c: { body: string }) => c.body)).toEqual(['first!', 'thanks!']);
    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.commentCount).toBe(2);

    const notifications = await prisma.notification.findMany({ where: { userId: author.id } });
    expect(notifications.some((n) => n.type === 'post_comment')).toBe(true);
  });

  it('lists a viewer’s liked and saved posts', async () => {
    const author = await registerUser();
    const viewer = await registerUser();
    const post = await createPost(author);

    await asUser(viewer).post(`/posts/${post.id}/like`);
    await asUser(viewer).post(`/posts/${post.id}/save`);

    const liked = await asUser(viewer).get('/posts/liked');
    expect(liked.body.items.map((p: { id: string }) => p.id)).toContain(post.id);

    const saved = await asUser(viewer).get('/posts/saved');
    expect(saved.body.items.map((p: { id: string }) => p.id)).toContain(post.id);
  });
});

describe('owner-only delete & view counting', () => {
  it('deletes only for the author, and view count skips self-views', async () => {
    const author = await registerUser();
    const other = await registerUser();
    const post = await createPost(author);

    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.viewCount).toBe(0);

    await asUser(other).get(`/posts/${post.id}`);
    expect((await asUser(author).get(`/posts/${post.id}`)).body.post.viewCount).toBe(1);

    expect((await asUser(other).delete(`/posts/${post.id}`)).status).toBe(403);
    expect((await asUser(author).delete(`/posts/${post.id}`)).status).toBe(200);
    expect((await asUser(author).get(`/posts/${post.id}`)).status).toBe(404);
  });
});

describe('hashtag page ranking & explore feed (§13.2, §13.7)', () => {
  it('ranks a hashtag page by engagement and excludes non-public authors', async () => {
    const marker = uname('tag');
    const authorA = await registerUser();
    const authorB = await registerUser();
    const nonPublicAuthor = await registerUser();
    await setVisibility(nonPublicAuthor, 'friends');
    const liker = await registerUser();

    const lowEngagement = await createPost(authorA, { caption: `low #${marker}` });
    const highEngagement = await createPost(authorB, { caption: `high #${marker}` });
    await createPost(nonPublicAuthor, { caption: `hidden #${marker}` });

    await asUser(liker).post(`/posts/${highEngagement.id}/like`);

    const page = await asUser(liker).get(`/hashtags/${marker}`);
    expect(page.status).toBe(200);
    const ids = page.body.items.map((p: { id: string }) => p.id);
    expect(ids).toEqual([highEngagement.id, lowEngagement.id]);
  });

  it('drops a post from hashtag discovery once its author goes non-public (§13.3)', async () => {
    const marker = uname('drop');
    const author = await registerUser();
    const viewer = await registerUser();
    await createPost(author, { caption: `will hide #${marker}` });

    expect((await asUser(viewer).get(`/hashtags/${marker}`)).body.items).toHaveLength(1);
    await setVisibility(author, 'private');
    expect((await asUser(viewer).get(`/hashtags/${marker}`)).body.items).toHaveLength(0);
  });

  it('explore feed paginates public posts with a cursor', async () => {
    const author = await registerUser();
    await createPost(author, { caption: 'explore me one' });
    await createPost(author, { caption: 'explore me two' });

    const firstPage = await asUser(author).get('/feed/explore?limit=1');
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).toBeDefined();

    const secondPage = await asUser(author).get(
      `/feed/explore?limit=1&cursor=${firstPage.body.nextCursor}`,
    );
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
  });
});

describe('profile posts grid', () => {
  it('lists a user’s own posts, gated the same as their profile', async () => {
    const author = await registerUser();
    await setVisibility(author, 'private');
    const stranger = await registerUser();
    const friend = await registerUser();
    await befriend(author, friend);
    await createPost(author, { caption: 'grid post' });

    expect((await asUser(stranger).get(`/users/${author.username}/posts`)).status).toBe(404);
    const friendView = await asUser(friend).get(`/users/${author.username}/posts`);
    expect(friendView.status).toBe(200);
    expect(friendView.body.items).toHaveLength(1);
  });
});

describe('feed caching (§13.2/§13.7, M8)', () => {
  it('reflects a newly created post on the very next hashtag read', async () => {
    const author = await registerUser();
    // A unique tag guarantees this post is the only item in its window,
    // so the assertion holds regardless of ranking/pagination against
    // whatever else has accumulated in the shared test DB.
    const tag = uname('cachetag');

    // First read populates the cache for this (fresh, empty) tag/window.
    const emptyTagPage = await asUser(author).get(`/hashtags/${tag}`);
    expect(emptyTagPage.body.items).toHaveLength(0);

    const post = await createPost(author, { caption: `caching check #${tag}` });

    const tagPage = await asUser(author).get(`/hashtags/${tag}`);
    expect(tagPage.body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
  });
});
