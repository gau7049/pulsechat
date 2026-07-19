import { chromium } from '@playwright/test';

const out = process.argv[2];
const shots = [
  { name: 'login-desktop', url: 'http://localhost:8000/login', w: 1280, h: 800 },
  { name: 'login-mobile', url: 'http://localhost:8000/login', w: 375, h: 812 },
  { name: 'register-mobile', url: 'http://localhost:8000/register', w: 375, h: 812 },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${s.name}.png` });
  await page.close();
}
await browser.close();
console.log('done');
