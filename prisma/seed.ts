/**
 * Seed & demo data (Technical Spec §20): a small connected graph — 15 users
 * across all three privacy levels + 1 admin, friendships, posts across
 * hashtag buckets, likes/comments/saves, statuses, one open report, and a
 * couple of notifications.
 *
 * Conversations/messages are deliberately NOT seeded here: messages are
 * end-to-end encrypted client-side (Technical Spec §6) — there is no way to
 * produce server-side-decryptable ciphertext without the real browser
 * keypair + password-unlock + IndexedDB flow, which a Node script cannot
 * reproduce. The Playwright e2e spec (`e2e/signup-friend-chat-post.spec.ts`)
 * drives the real UI to create a real encrypted conversation instead — a
 * truer demonstration than fake seed ciphertext would be.
 */
import { PrismaClient, Visibility, type StatusVisibility } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

/**
 * Real Argon2id hash — same options as `apps/api/src/services/password.service.ts`,
 * duplicated rather than cross-imported so this root script doesn't reach
 * into the API app's internal module graph. Every seed account is loginable
 * with its documented `{username}-dev-password` convention.
 */
function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

interface SeedUser {
  username: string;
  displayName: string;
  visibility: Visibility;
  bio?: string;
  country?: string;
}

const SEED_USERS: SeedUser[] = [
  {
    username: 'aarav',
    displayName: 'Aarav Sharma',
    visibility: 'public',
    bio: 'Coffee, code, cricket',
    country: 'India',
  },
  {
    username: 'priya',
    displayName: 'Priya Patel',
    visibility: 'public',
    bio: 'Sunset photographer',
    country: 'India',
  },
  {
    username: 'kabir',
    displayName: 'Kabir Mehta',
    visibility: 'friends',
    bio: 'Drummer 🥁',
    country: 'India',
  },
  { username: 'ananya', displayName: 'Ananya Rao', visibility: 'private', country: 'India' },
  { username: 'dev', displayName: 'Dev Joshi', visibility: 'public', bio: 'Trail runner' },
  { username: 'meera', displayName: 'Meera Nair', visibility: 'friends', bio: 'Bookworm' },
  {
    username: 'rohan',
    displayName: 'Rohan Gupta',
    visibility: 'public',
    bio: 'Street food hunter',
  },
  { username: 'isha', displayName: 'Isha Verma', visibility: 'private' },
  { username: 'arjun', displayName: 'Arjun Singh', visibility: 'public', bio: 'Gamer / streamer' },
  { username: 'tara', displayName: 'Tara Iyer', visibility: 'friends', bio: 'Plant mom 🌱' },
  { username: 'vivaan', displayName: 'Vivaan Kapoor', visibility: 'public' },
  { username: 'sana', displayName: 'Sana Khan', visibility: 'public', bio: 'Sketch artist' },
  { username: 'nikhil', displayName: 'Nikhil Bose', visibility: 'friends' },
  {
    username: 'zoya',
    displayName: 'Zoya Ahmed',
    visibility: 'private',
    bio: 'Quiet corner enjoyer',
  },
  { username: 'aditya', displayName: 'Aditya Kulkarni', visibility: 'public', bio: 'Cyclist' },
];

/** username pairs that become accepted friends (a connected, clustery graph) */
const SEED_FRIENDSHIPS: Array<[string, string]> = [
  ['aarav', 'priya'],
  ['aarav', 'kabir'],
  ['aarav', 'dev'],
  ['priya', 'meera'],
  ['priya', 'sana'],
  ['kabir', 'rohan'],
  ['ananya', 'meera'],
  ['dev', 'arjun'],
  ['meera', 'tara'],
  ['rohan', 'vivaan'],
  ['isha', 'zoya'],
  ['arjun', 'nikhil'],
  ['tara', 'sana'],
  ['vivaan', 'aditya'],
  ['nikhil', 'aarav'],
  ['zoya', 'priya'],
];

/** Public-domain Cloudinary demo asset — no account/signing needed. */
const DEMO_IMAGE = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

/** username + caption (hashtags parsed the same way the API does). Public-visibility authors only — matches §13.1/§13.3's hashtag-indexing rule. */
const SEED_POSTS: Array<[string, string]> = [
  ['aarav', 'Nothing like a hot cup of chai to start the day ☕ #food #morning'],
  ['aarav', 'Weekend nets session, finally got my cover drive back #cricket #sport'],
  ['priya', 'Golden hour never disappoints 🌅 #photography #travel'],
  ['priya', 'Backstreets of the old city, my favourite kind of wander #travel #photography'],
  ['dev', '10k done, legs are jelly #fitness #running'],
  ['dev', 'New trail, same obsession #nature #fitness'],
  ['rohan', 'Found the best street food stall in the city #food #streetfood'],
  ['rohan', 'Midnight snack run, no regrets #food'],
  ['arjun', 'New setup, new year, let’s go #tech #gaming'],
  ['arjun', 'Finally beat that boss after 30 tries #gaming'],
  ['vivaan', 'Weekend hike with the crew #nature #travel'],
  ['vivaan', 'Campfire stories hit different #nature'],
  ['sana', 'Quick sketch from today’s train ride #art #sketch'],
  ['sana', 'Working on a new series this week #art'],
  ['aditya', '50km ride done before breakfast #fitness #cycling'],
  ['aditya', 'New gear day #cycling #tech'],
];

async function main(): Promise<void> {
  // Admin account, isolated from regular users (Requirement Scope §5.3).
  const adminPasswordHash = await hashPassword('admin-dev-password');
  await prisma.user.upsert({
    where: { username: 'pulse_admin' },
    // Re-running always fixes the password — earlier seed runs (pre-M8) wrote
    // an unloginable SHA-256 placeholder here; `update` must re-apply the
    // real Argon2id hash on an already-existing row, not just at creation.
    update: { passwordHash: adminPasswordHash },
    create: {
      username: 'pulse_admin',
      displayName: 'PulseChat Admin',
      passwordHash: adminPasswordHash,
      role: 'admin',
      visibility: 'private',
      privacy: { create: {} },
    },
  });

  for (const seedUser of SEED_USERS) {
    const passwordHash = await hashPassword(`${seedUser.username}-dev-password`);
    await prisma.user.upsert({
      where: { username: seedUser.username },
      update: { passwordHash },
      create: {
        username: seedUser.username,
        displayName: seedUser.displayName,
        passwordHash,
        visibility: seedUser.visibility,
        bio: seedUser.bio,
        country: seedUser.country,
        privacy: { create: {} },
      },
    });
  }

  // Scoped to exactly the named seed usernames — never all rows in the DB,
  // which would sweep in unrelated accounts created via manual browser
  // testing and corrupt the "already seeded" check below.
  const seedUsernames = [...SEED_USERS.map((u) => u.username), 'pulse_admin'];
  const users = await prisma.user.findMany({
    where: { username: { in: seedUsernames } },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });
  const byUsername = new Map(users.map((user) => [user.username, user]));
  const idByUsername = new Map(users.map((user) => [user.username, user.id]));

  for (const [a, b] of SEED_FRIENDSHIPS) {
    const idA = idByUsername.get(a);
    const idB = idByUsername.get(b);
    if (!idA || !idB) continue;
    // Friendship rows are stored once with userAId < userBId (see schema note).
    const [userAId, userBId] = idA < idB ? [idA, idB] : [idB, idA];
    await prisma.friendship.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      update: {},
      create: { userAId, userBId },
    });
  }

  // Idempotency guard: everything below has no natural unique business key
  // (unlike the upserts above), so only seed it once per database.
  const alreadySeeded = await prisma.post.count({
    where: { authorId: { in: [...idByUsername.values()] } },
  });
  if (alreadySeeded > 0) {
    const counts = {
      users: await prisma.user.count(),
      friendships: await prisma.friendship.count(),
    };
    process.stdout.write(
      `Seeded: ${counts.users} users, ${counts.friendships} friendships (content already seeded, skipped)\n`,
    );
    return;
  }

  // ── Posts + hashtags (§13.1, §13.3) ─────────────────────────────────────
  const hashtagPattern = /#(\w{1,64})/g;
  const postIds: string[] = [];
  for (const [username, caption] of SEED_POSTS) {
    const authorId = idByUsername.get(username);
    if (!authorId) continue;
    const tags = [
      ...new Set([...caption.matchAll(hashtagPattern)].map((m) => m[1]!.toLowerCase())),
    ];
    const post = await prisma.post.create({
      data: {
        authorId,
        mediaUrl: DEMO_IMAGE,
        caption,
        hashtags: {
          create: tags.map((tag) => ({
            hashtag: { connectOrCreate: { where: { tag }, create: { tag } } },
          })),
        },
      },
    });
    postIds.push(post.id);
  }

  // ── Likes, comments, saves (§13.5) — a handful per post, never the author ──
  const likers = ['priya', 'dev', 'sana', 'tara', 'meera', 'ananya', 'nikhil'];
  const commenters: Array<[string, string]> = [
    ['dev', 'This is great!'],
    ['priya', 'Love this 😍'],
    ['rohan', 'Adding to my list'],
    ['arjun', 'Same energy'],
  ];
  for (const [index, postId] of postIds.entries()) {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    const postLikers = likers
      .filter((u) => idByUsername.get(u) !== post.authorId)
      .slice(0, 2 + (index % 2));
    for (const username of postLikers) {
      const userId = idByUsername.get(username);
      if (!userId) continue;
      await prisma.like.create({ data: { postId, userId } });
    }
    if (postLikers.length > 0) {
      await prisma.post.update({ where: { id: postId }, data: { likeCount: postLikers.length } });
    }
    if (index % 2 === 0) {
      const [commenter, body] = commenters[index % commenters.length]!;
      const userId = idByUsername.get(commenter);
      if (userId && userId !== post.authorId) {
        await prisma.comment.create({ data: { postId, userId, body } });
        await prisma.post.update({ where: { id: postId }, data: { commentCount: 1 } });
      }
    }
    if (index === 0) {
      const saverId = idByUsername.get('meera');
      if (saverId) await prisma.save.create({ data: { postId, userId: saverId } });
    }
  }

  // ── Statuses (§11) — a few active ones so the home rail isn't empty ──────
  const dayMs = 24 * 60 * 60 * 1000;
  const SEED_STATUSES: Array<[string, string, StatusVisibility]> = [
    ['priya', 'Chasing sunsets again 🌇', 'everyone'],
    ['dev', 'Race day tomorrow, nervous energy', 'friends'],
    ['sana', 'New sketchbook, fresh start', 'everyone'],
  ];
  for (const [username, caption, visibility] of SEED_STATUSES) {
    const userId = idByUsername.get(username);
    if (!userId) continue;
    await prisma.status.create({
      data: {
        userId,
        caption,
        visibility,
        expiresAt: new Date(Date.now() + dayMs),
      },
    });
  }

  // ── One open report (§18) — gives the admin queue non-empty content ──────
  const firstPostId = postIds[0];
  const reporterId = idByUsername.get('ananya');
  if (firstPostId && reporterId) {
    await prisma.report.create({
      data: {
        reporterId,
        targetType: 'post',
        targetId: firstPostId,
        reason: 'This looks like spam / misleading content.',
      },
    });
  }

  // ── A couple of notifications (§12, §17) — mirror notify()'s payload shape ──
  const nikhil = byUsername.get('nikhil');
  const isha = byUsername.get('isha');
  if (nikhil && isha) {
    // Safe to create unconditionally — this whole block only ever runs once
    // per database, guarded by `alreadySeeded` above.
    const request = await prisma.friendRequest.create({
      data: { fromUserId: nikhil.id, toUserId: isha.id },
    });
    await prisma.notification.create({
      data: {
        userId: isha.id,
        type: 'friend_request',
        payloadJson: {
          from: {
            id: nikhil.id,
            username: nikhil.username,
            displayName: nikhil.displayName,
            avatarUrl: nikhil.avatarUrl,
          },
          requestId: request.id,
        },
      },
    });
  }
  const priya = byUsername.get('priya');
  const aarav = byUsername.get('aarav');
  if (priya && aarav && postIds[0]) {
    await prisma.notification.create({
      data: {
        userId: aarav.id,
        type: 'post_like',
        payloadJson: {
          from: {
            id: priya.id,
            username: priya.username,
            displayName: priya.displayName,
            avatarUrl: priya.avatarUrl,
          },
          postId: postIds[0],
        },
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    friendships: await prisma.friendship.count(),
    posts: await prisma.post.count(),
    statuses: await prisma.status.count(),
    reports: await prisma.report.count(),
    notifications: await prisma.notification.count(),
  };
  process.stdout.write(
    `Seeded: ${counts.users} users, ${counts.friendships} friendships, ${counts.posts} posts, ` +
      `${counts.statuses} statuses, ${counts.reports} reports, ${counts.notifications} notifications\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
