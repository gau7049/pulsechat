/**
 * Seed & demo data (Technical Spec §20): a small connected graph — ~15 users
 * across all three privacy levels, friendships, conversations with sample
 * encrypted messages, posts per hashtag bucket, and one open report.
 *
 * M0 ships the skeleton with users + privacy settings + friendships; content
 * seeding grows with each milestone that adds the corresponding feature
 * (encrypted messages need the M3 client-crypto helpers to produce real
 * ciphertext — plaintext placeholders would violate the encryption-at-rest
 * design).
 */
import { PrismaClient, Visibility } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

/**
 * Deterministic placeholder hash so seeding never depends on the API's Argon2
 * runtime. Replaced by real Argon2id hashes when the M1 auth service lands —
 * these accounts are not loggable-in until then, which is fine for M0.
 */
function placeholderPasswordHash(password: string): string {
  return `seed-placeholder:${createHash('sha256').update(password).digest('hex')}`;
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

async function main(): Promise<void> {
  // Admin account, isolated from regular users (Requirement Scope §5.3).
  await prisma.user.upsert({
    where: { username: 'pulse_admin' },
    update: {},
    create: {
      username: 'pulse_admin',
      displayName: 'PulseChat Admin',
      passwordHash: placeholderPasswordHash('admin-dev-password'),
      role: 'admin',
      visibility: 'private',
      privacy: { create: {} },
    },
  });

  for (const seedUser of SEED_USERS) {
    await prisma.user.upsert({
      where: { username: seedUser.username },
      update: {},
      create: {
        username: seedUser.username,
        displayName: seedUser.displayName,
        passwordHash: placeholderPasswordHash(`${seedUser.username}-dev-password`),
        visibility: seedUser.visibility,
        bio: seedUser.bio,
        country: seedUser.country,
        privacy: { create: {} },
      },
    });
  }

  const users = await prisma.user.findMany({ select: { id: true, username: true } });
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

  // TODO(M3+): conversations with real client-encrypted sample messages.
  // TODO(M6): posts across hashtag buckets. TODO(M7): one open report.

  const counts = {
    users: await prisma.user.count(),
    friendships: await prisma.friendship.count(),
  };
  process.stdout.write(`Seeded: ${counts.users} users, ${counts.friendships} friendships\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
