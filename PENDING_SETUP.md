# Pending Manual Setup

Everything the code needs that only a human can provide: real accounts, API keys, and
one-time provisioning. **None of this blocks development** — every optional provider has a
console-logging or no-op fallback when its key is absent (see `apps/api/src/config/env.ts`),
so the app runs correctly today with reduced functionality. This file is the single place to
check "what's still a placeholder"; `DEPLOYMENT.md` covers *shipping* the app once you're ready.

Status last verified directly against `.env` on 2026-07-17.

## Quick status

| Item                     | Status                                        | Blocks                              |
| ------------------------ | ---------------------------------------------- | ------------------------------------ |
| Supabase `DATABASE_URL`  | ✅ set, migrations applied through `m11_group_admin_media` | —                       |
| JWT secrets               | ✅ dev values in `.env`                       | Must regenerate fresh ones at deploy |
| Cloudflare Turnstile      | ✅ working (site + secret)                    | —                                    |
| Cloudinary                 | ✅ working (avatars, attachments, posts, group photos) | —                          |
| Brevo (transactional email) | ⚠️ wrong key type — see below               | Real email delivery (logs to terminal meanwhile) |
| TURN (coturn)              | ⬜ empty — STUN-only fallback works           | Calls/live across strict NATs        |
| VAPID (Web Push)           | ⬜ empty                                      | Push notifications (no-op meanwhile) |
| TMDB (trending movies)     | ⬜ not set at all                             | Trending movies rail (Deezer songs still work) |
| CC0 status music           | ⬜ placeholder catalog, files don't exist yet | Status background-music playback     |
| Real PNG app icons         | ⬜ placeholder SVG mark only                  | Clean iOS "Add to Home Screen" icon  |
| ToS / Privacy Policy copy  | ⬜ placeholder text, clearly marked           | Real legal compliance                |
| Deploy accounts (Vercel/Render/B2/UptimeRobot) | ⬜ not created yet     | First production deploy — see `DEPLOYMENT.md` |
| Playwright browser binary  | ⬜ not installed                              | `pnpm test:e2e` (local-only, optional) |

## Details

### 1. TURN server (Oracle Cloud VM + coturn)

**Why:** WebRTC calls/live broadcasting currently work STUN-only (Google's public STUN
server, no key needed) — fine on the same network or most home connections, but will fail to
connect across strict NATs/corporate firewalls without a TURN relay.

**What to do:** Follow `infra/coturn/README.md` (~30 min) to stand up a free Oracle Cloud
Always-Free VM running coturn. It produces two values:

- `TURN_HOST` — the VM's public hostname/IP
- `TURN_SHARED_SECRET` — must match `static-auth-secret` in `infra/coturn/turnserver.conf`

Paste both into `.env` (and the Render environment once deployed) — `turn.service.ts` picks
them up automatically, no code change needed.

### 2. VAPID keypair (Web Push)

**Why:** `POST/DELETE /push/subscribe` and every `notify()` push call are currently a no-op
— notifications still land in-app (bell, `/notifications`), they just never reach a closed
browser tab or installed PWA.

**What to do:**

```
npx web-push generate-vapid-keys
```

Paste the output into `.env`:

```
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="..."
VITE_VAPID_PUBLIC_KEY="..."   # same public key, frontend build var
```

### 3. Brevo API key swap

**Why:** Real email delivery (verification, magic link, OTP, new-device confirmation,
password reset, account restore) currently just prints to the API terminal.

**What's wrong:** The `.env` value is an **SMTP** key (starts `xsmtpsib-`). Brevo's REST API
— which is what `apps/api` actually calls — needs an **API** key (starts `xkeysib-`) instead.

**What to do:** Brevo dashboard → SMTP & API → API Keys → generate one, replace
`BREVO_API_KEY` in `.env`.

### 4. TMDB API key

**Why:** The Explore page's "Trending" rail shows movies + songs; without this key the
trending-cache sweep skips movies and only refreshes Deezer songs (which need no key).

**What to do:** Free-tier signup at themoviedb.org → API key → `TMDB_API_KEY` in `.env`.

### 5. CC0 status background music

**Why:** The status composer ships a 6-track placeholder catalog
(`packages/shared/src/status-music.ts`) whose `fileUrl`s point at files that don't exist yet
— the viewer already treats a 404 as "unavailable" rather than failing the status, so this is
purely a missing-asset gap, not a bug.

**What to do:** Pick a handful of short CC0 tracks (no attribution required) from Free Music
Archive, Pixabay Music, or Chosic, drop the files at `apps/web/public/audio/status/`, and
update the catalog's `fileUrl`s to match — a data-only change.

### 6. Real PNG app icons

**Why:** The PWA manifest currently references `apps/web/public/icon.svg`, a placeholder
mark. Android/Chrome/Edge accept an SVG manifest icon fine, but iOS's Add-to-Home-Screen icon
support for SVG is inconsistent across versions.

**What to do:** Once real branding art exists, generate 192px/512px PNGs plus a dedicated
apple-touch-icon PNG and swap them in — same pattern as the music catalog, a data-only asset
swap.

### 7. Real ToS / Privacy Policy copy

**Why:** Placeholder legal text is live and clearly marked as such; it satisfies the app
functionally (pages exist, are linked from settings/signup) but isn't real legal copy.

**What to do:** Human/legal decision — not a coding task. Drop the final copy into the
existing legal pages once you have it.

### 8. First deploy accounts

**Why:** Nothing beyond local dev needs these yet.

**What to do:** See `DEPLOYMENT.md` — Vercel, Render, Backblaze B2, and UptimeRobot accounts,
created when you're actually ready to ship.

### 9. Playwright browser binary (optional, local-only)

**Why:** `pnpm test:e2e` needs a real Chromium binary; this was deliberately left as a manual
step (build-script approval was declined for `@playwright/browser-chromium` in
`pnpm-workspace.yaml`) rather than something that silently downloads a browser during
`pnpm install`.

**What to do (once, before the first e2e run):**

```
pnpm exec playwright install chromium
```

Also unset `TURNSTILE_SECRET` / `VITE_TURNSTILE_SITE_KEY` for that run — neither Playwright
nor Artillery (`pnpm test:load`) can solve a real Turnstile challenge.

### 10. PWA real-device install testing

**Why:** Install prompt, offline shell load, push delivery in the installed/standalone
context, camera/attachment picker, and touch-target sizing have only been checked in a
desktop browser so far.

**What to do:** One real Android device and one real iOS device, manual pass through the
checklist above. No paid device-farm service needed.

---

Whenever any of these are ready, drop the resulting values/files in and let the agent know —
every item here is a config or data swap with no code change required except where noted.
