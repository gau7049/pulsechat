# Deployment Guide

How to ship PulseChat to production on the free-tier stack this project was built for.
Some steps below (TURN, VAPID, Brevo) need provider keys that may still be placeholders —
see `.env.example` for the full list of variables and `apps/api/src/config/env.ts` for which
ones no-op safely when unset.

## Architecture

| Layer                        | Platform                                                 | Why                                                           |
| ---------------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Web app (`apps/web`)         | **Vercel**                                               | Static Vite build, free tier, git-integrated                  |
| API + Socket.IO (`apps/api`) | **Render** (Web Service, not serverless)                 | Long-lived process required for websocket connections         |
| Database                     | **Supabase** (Postgres)                                  | Free tier, provisioned via the Supabase dashboard             |
| DB backups                   | GitHub Actions nightly cron → **Backblaze B2**           | Free tier, already scripted in `.github/workflows/backup.yml` |
| TURN relay (calls/live)      | Self-hosted **coturn** on an Oracle Cloud Always-Free VM | Only real always-on infra piece; STUN-only works without it   |
| Uptime monitoring            | **UptimeRobot**                                          | Free tier, pings `/healthz`                                   |
| CI/CD                        | **GitHub Actions**                                       | Already wired — see below                                     |

There is no `Dockerfile` or `render.yaml` in the repo — Render is configured through its
dashboard, using the existing `package.json` scripts directly. The API's `"build"` script
typechecks (`tsc --noEmit`) and then bundles the server — plus the TS-only
`@pulsechat/shared` package — into a single `dist/index.js` with esbuild (`build.mjs`);
`"start"` runs that compiled file on plain `node`. This matters on Render's free tier: the
previous `tsx src/index.ts` start transpiled the whole source graph at boot and kept esbuild
resident, and that cold-start spike overran the **512 MB** memory limit. The compiled server
idles around ~80 MB instead. `dev` still uses `tsx watch` for fast local iteration; only
production is compiled. The `--max-old-space-size=384` flag in `start` is a safety cap that
makes V8 collect garbage well before the container limit rather than letting it grow into an
OOM kill.

`apps/web/vercel.json` (added in M12) sets security response headers (CSP, HSTS,
X-Frame-Options, etc.) for the deployed SPA — **before your first deploy**, replace the two
`REPLACE-WITH-YOUR-API-DOMAIN.onrender.com` placeholders in its `connect-src` directive with
your actual Render API domain from Step 1, or the app's `fetch`/Socket.IO calls will be
blocked by the browser. If you later configure TURN, verify calls still
connect in a real browser afterward — WebRTC's interaction with `connect-src` varies enough
across browsers that it's worth a manual check rather than assuming.

## One-time account setup

Create these if you haven't already (all free tier):

1. **Vercel** — vercel.com, connect your GitHub account.
2. **Render** — render.com, connect your GitHub account.
3. **Backblaze B2** — backblaze.com/b2, create a bucket (e.g. `pulsechat-backups`) and an
   application key scoped to it. Note the Key ID, Application Key, and bucket name.
4. **UptimeRobot** — uptimerobot.com, free tier.
5. **Supabase** — supabase.com, create a project and copy its Postgres connection string.

## Step 1 — Deploy the API to Render

1. New → Web Service → connect the GitHub repo.
2. **Root Directory:** leave as the repo root (pnpm workspace — Render needs to see
   `pnpm-workspace.yaml` to install correctly).
3. **Build Command:**
   ```
   pnpm install --frozen-lockfile && pnpm db:generate && pnpm --filter @pulsechat/api build && pnpm db:deploy
   ```
   `db:generate` runs `prisma generate` (needed before the app can import `@prisma/client`
   types); `pnpm --filter @pulsechat/api build` typechecks and bundles the server to
   `dist/index.js` (what `start` runs); `db:deploy` runs `prisma migrate deploy` — the same
   non-interactive migration command CI already uses (`.github/workflows/ci.yml`), safe to run
   on every deploy since it only applies migrations that haven't run yet. (Only the API is
   built here — the web app deploys separately to Vercel, so there's no need to build it on
   Render.)
4. **Start Command:**
   ```
   pnpm --filter @pulsechat/api start
   ```
   (runs `node --max-old-space-size=384 dist/index.js` — the file produced by the build step
   above, so make sure the build ran successfully first).
5. **Environment variables** (Render dashboard → Environment): set every var from
   `.env.example`, with these production-specific values:
   - `NODE_ENV=production`
   - `DATABASE_URL` — the **same** Supabase connection string from your local `.env` (the
     schema hard-requires this one in production, see `apps/api/src/config/env.ts:42`)
   - `APP_ORIGIN` — leave as `http://localhost:8000` for now; you'll come back and set this
     to your real Vercel URL after Step 2 (it drives both CORS and every generated email
     link — verify/magic-link/reset-password/confirm-device/account-restore)
   - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — **generate fresh ones**, don't reuse the
     dev values:
     ```
     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
     ```
     (run twice, once per secret)
   - Everything else (`BREVO_API_KEY`, `TURNSTILE_SECRET`, `CLOUDINARY_URL`,
     `TURN_SHARED_SECRET`, `TURN_HOST`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
     `TMDB_API_KEY`) — copy whatever's real in your `.env`; leave placeholder ones unset, the
     corresponding feature just no-ops
   - Do **not** set `PORT` — Render injects its own and the app already reads
     `process.env.PORT` (default 4000 only applies when unset).
6. Deploy. Once live, note the Render URL (e.g. `https://pulsechat-api.onrender.com`) — you
   need it for Step 2.
7. Confirm health: `curl https://<your-render-url>/healthz` should return 200.

## Step 2 — Deploy the web app to Vercel

1. New Project → import the same GitHub repo.
2. **Root Directory:** `apps/web`.
3. **Framework Preset:** Vite (should auto-detect).
4. **Build Command:** `pnpm build` (runs `tsc --noEmit && vite build` per
   `apps/web/package.json`). If Vercel's monorepo detection doesn't install workspace deps
   correctly from `apps/web` alone, override the Install Command to run from the repo root:
   ```
   cd ../.. && pnpm install --frozen-lockfile
   ```
5. **Output Directory:** `dist`.
6. **Environment variables** — set these directly in Vercel's project settings (not via a
   `.env` file: `vite.config.ts`'s `envDir: '../..'` only matters for local dev, where a root
   `.env` exists; Vercel's build environment has no such file, so every `VITE_`-prefixed var
   must be configured here):
   - `VITE_API_URL` — the Render URL from Step 1 (e.g. `https://pulsechat-api.onrender.com`)
   - `VITE_TURNSTILE_SITE_KEY` — your Turnstile site key
   - `VITE_VAPID_PUBLIC_KEY` — same public key you set on Render, if VAPID is configured
7. Deploy. Note your production URL (e.g. `https://pulsechat.vercel.app`, or a custom domain
   if you attach one).

## Step 3 — Close the loop: point the API at the real web origin

Go back to Render → Environment → set `APP_ORIGIN` to your actual Vercel URL from Step 2,
then redeploy (Render restarts automatically on env var change). This is what allows the API
to accept CORS requests from the real frontend and generate correct links in emails.

## Step 4 — Wire up CI auto-deploy (optional but already scripted)

`.github/workflows/ci.yml` already has a `deploy` job that fires on every push to `main`
after tests pass — it's just gated off until you provide two deploy-hook URLs:

1. **Render:** Dashboard → your service → Settings → Deploy Hook → copy the URL.
2. **Vercel:** Project Settings → Git → Deploy Hooks → create one → copy the URL.
3. In the GitHub repo: Settings → Secrets and variables → Actions:
   - Add secrets `RENDER_DEPLOY_HOOK_URL` and `VERCEL_DEPLOY_HOOK_URL` with those two URLs.
   - Add repository **variables** (not secrets) `RENDER_DEPLOY_HOOK_SET=true` and
     `VERCEL_DEPLOY_HOOK_SET=true` — these are the flags CI checks before firing each curl.

From then on, every merge to `main` that passes lint/typecheck/test/build auto-redeploys both
services.

## Step 5 — Nightly DB backups

`.github/workflows/backup.yml` already runs nightly (03:00 IST) and on manual trigger; it
just needs four GitHub repo secrets:

- `DATABASE_URL` — same Supabase connection string
- `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` — from the Backblaze B2
  account you created above

Backups older than 14 days are pruned automatically. Trigger one manually once set up
(Actions tab → "Nightly DB backup" → Run workflow) to confirm it works before waiting for the
schedule.

## Step 6 — TURN server (only if calls need to work across strict NATs)

Follow `infra/coturn/README.md` to provision the Oracle Cloud VM, then set `TURN_HOST` /
`TURN_SHARED_SECRET` on Render (Step 1's env vars) and redeploy. Calls work STUN-only without
this — it's an upgrade, not a blocker.

## Step 7 — Uptime monitoring

UptimeRobot → Add New Monitor → HTTP(s) → point at
`https://<your-render-url>/healthz`. Optionally add a second monitor for the Vercel URL
itself. Free tier checks every 5 minutes and can alert by email/SMS on downtime.

## Post-deploy smoke test

Run through this by hand once, on the real deployed URLs:

- [ ] Register a new account (confirms `DATABASE_URL`, Turnstile if configured, and — if
      Brevo is set up — a real verification email arrives instead of console-logging)
- [ ] Log in, confirm the session persists across a refresh (JWT secrets working)
- [ ] Send a friend request between two accounts, accept it
- [ ] Start a direct chat, send a message, confirm it decrypts and shows live ticks
- [ ] Create a post with a photo (confirms `CLOUDINARY_URL`)
- [ ] Like a post, confirm the notification bell updates
- [ ] If VAPID is configured: enable push in Settings, close the tab, trigger a notification
      from another account, confirm a real OS push arrives
- [ ] If TURN is configured: place a call from two devices on different networks (not just
      same-WiFi) and confirm it connects
- [ ] Check `/healthz` returns 200 and UptimeRobot shows the monitor as up

## Rolling back

Both Vercel and Render keep prior deploys — use their dashboard's "rollback to previous
deploy" action if a bad deploy ships. Database migrations are additive-only throughout this
project's history (every milestone's migration adds columns/tables, never drops), so rolling
back the app code is safe without a matching DB rollback in the common case; check the
specific migration if you ever need to roll back past one that wasn't purely additive.
