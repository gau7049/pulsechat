import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_IMAGE = path.join(__dirname, 'fixtures', 'sample.png');
const PASSWORD = 'correct-horse-battery-9';

function uniqueUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(
    0,
    20,
  );
}

async function registerUser(page: Page, username: string, displayName: string): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Display name', { exact: true }).fill(displayName);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL('/');
  // First-login tour blocks the whole screen — dismiss it before anything else.
  await page.getByRole('button', { name: 'Skip tour' }).click();
}

/**
 * Local-only e2e spec (ROADMAP M8, not run in CI — see playwright.config.ts).
 * Drives two real browser contexts through the full spec-required path:
 * signup → friend request → accept → encrypted chat → post. This exercises
 * the actual client-side E2E crypto pipeline (Technical Spec §6) — a real
 * demonstration, not a mock, which is also why message content is never
 * seeded server-side (see prisma/seed.ts's header comment).
 */
test('signup, friend, encrypted chat, and post', async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  try {
    const aliceUsername = uniqueUsername('alice');
    const bobUsername = uniqueUsername('bob');

    await test.step('register both accounts', async () => {
      await registerUser(alice, aliceUsername, 'Alice E2E');
      await registerUser(bob, bobUsername, 'Bob E2E');
    });

    await test.step('Alice sends a friend request to Bob', async () => {
      await alice.goto('/people/search');
      await alice.getByLabel('Find people').fill(bobUsername);
      await expect(alice.getByText(bobUsername)).toBeVisible();
      await alice.getByRole('button', { name: 'Add friend' }).click();
      await expect(alice.getByRole('button', { name: 'Cancel request' })).toBeVisible();
    });

    await test.step('Bob accepts the friend request', async () => {
      await bob.goto('/people/requests');
      await expect(bob.getByText('Alice E2E')).toBeVisible();
      await bob.getByRole('button', { name: 'Accept' }).click();
      await expect(bob.getByText('Alice E2E')).not.toBeVisible();
    });

    const messageText = `Hello from the e2e run ${Date.now()}`;

    await test.step('Alice starts an encrypted chat with Bob and sends a message', async () => {
      await alice.goto('/chats');
      await expect(alice.getByRole('button', { name: 'New chat' })).toBeEnabled();
      await alice.getByRole('button', { name: 'New chat' }).click();
      await alice.getByLabel('Select Bob E2E').check();
      await alice.getByRole('button', { name: 'Start chat' }).click();
      await expect(alice).toHaveURL(/\/chats\/.+/);
      await alice.getByLabel('Message').fill(messageText);
      await alice.getByRole('button', { name: 'Send' }).click();
      await expect(alice.getByText(messageText)).toBeVisible();
    });

    await test.step('Bob opens the conversation and sees the decrypted message', async () => {
      await bob.goto('/chats');
      await expect(bob.getByText('Alice E2E')).toBeVisible({ timeout: 15_000 });
      await bob.getByText('Alice E2E').click();
      // A visible plaintext match here proves the real E2E round-trip: Bob's
      // browser fetched ciphertext over the wire and decrypted it locally.
      await expect(bob.getByText(messageText)).toBeVisible({ timeout: 15_000 });
    });

    await test.step('Alice creates a post and it appears on her profile', async () => {
      await alice.goto('/');
      await alice.getByRole('button', { name: 'Create post' }).click();
      await alice.getByRole('button', { name: 'Choose a photo' }).click();
      await alice.locator('input[type="file"]').setInputFiles(SAMPLE_IMAGE);
      await expect(alice.getByRole('dialog', { name: 'Edit photo' })).toBeVisible();
      await alice.getByRole('button', { name: 'Done' }).click();
      await alice.locator('textarea[placeholder*="caption"]').fill('Posted from the e2e run #e2e');
      await alice.getByRole('button', { name: 'Post' }).click();
      await expect(alice.getByRole('dialog', { name: 'New post' })).not.toBeVisible({
        timeout: 15_000,
      });

      await alice.goto(`/u/${aliceUsername}`);
      await expect(alice.locator('dt:has-text("Posts") + dd')).toHaveText('1');
    });
  } finally {
    await aliceCtx.close();
    await bobCtx.close();
  }
});
