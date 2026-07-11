# PulseChat — Build Roadmap & Status

> Session hand-off document. Read this first in a new session, alongside the source-of-truth docs
> in the repo root: `Web App Requirement Scope.md` + `Technical Specification.md` (markdown — the
> matching PDFs are image-only scans of the same content) and `Claude Code Build Instructions.md`.
> Update the checkboxes and the "Session log" as milestones progress.

## Fixed decisions

- App name **PulseChat** · pnpm monorepo (`apps/web`, `apps/api`, `packages/shared`, `prisma/`)
- **Pause for user review after each milestone** — never roll into the next one unprompted
- Dev DB = **Supabase cloud** (no Docker on this machine); tests use the `pulsechat_test` schema
  on the same instance (force-reset per run — user consented); CI uses an ephemeral Postgres service
- Web dev server on **:8000** (strictPort; `APP_ORIGIN` pinned), API on **:4000**
- Root `.env` is shared by both apps (Vite reads it via `envDir: '../..'`)
- Providers with unset/invalid keys fall back to console logging (emails print to API terminal)

## Milestones (Technical Spec §18)

### ✅ M0 — Scaffold & foundations (DONE, reviewed)

- pnpm workspace, strict TS, ESLint 9 flat + Prettier, `.gitattributes` (LF), `.env.example`
- Full Prisma schema — all Tech-Spec §4 entities + indexes + `(conversation_id, sequence)` /
  `(conversation_id, client_uuid)` uniques; initial migration applied to Supabase
- Seed: 16 users (3 privacy levels), 16 friendships, 1 admin (`prisma/seed.ts`)
- API: Express 5 + pino request-id logging, central error handler (shared `ApiErrorBody` shape),
  zod env config, `GET /healthz`, Socket.IO on same server
- Web: Vite + React 18 + Tailwind v4 design tokens (light/dark + 5 accents, WCAG-AA), UI
  primitives (Button/Input/Avatar/Skeleton/EmptyState/Modal/Toast/Switch), router, 404/error pages
- Infra: `.github/workflows/ci.yml` (lint→format→typecheck→test→build + deploy hooks),
  `backup.yml` (nightly pg_dump→B2, 14-day retention), `infra/coturn/` config + README

### ✅ M1 — Auth, profile, privacy (DONE — awaiting final user browser sign-off)

Backend (30 tests green in `apps/api/src/http/auth.integration.test.ts`):

- Register (Gmail-only optional email, age ≥13, reserved usernames, Argon2id, Turnstile)
- Login + exponential backoff (username+IP), JWT 15-min access + rotating refresh hashed on
  Device rows, refresh-reuse rejection, logout, remote session revoke, device list
- Magic link, email OTP 2FA (enable/disable), new-device email confirmation, email verification
  (+resend), forgot/reset/change password (revokes other sessions), owner audit log
- Profile/privacy CRUD, Cloudinary-signed avatar upload, onboarding-done endpoint
- Socket handshake now verifies JWT, joins `user:{id}` room
  Frontend:
- Register/login screens (live strength meter, real Turnstile widget), OTP + new-device stages,
  email-link landing pages (verify/magic/confirm-device/reset), forgot-password
- X25519 keypair generated at signup (libsodium-**sumo**), private key wrapped with
  password-derived key (Argon2id) in IndexedDB; only public key sent to server
- Silent session restore from httpOnly refresh cookie; single-flight 401 refresh-retry in api client
- App shell + guards; Settings: Profile (avatar upload), Privacy, Security (sessions, audit log,
  2FA, change password), Appearance; onboarding tour; guest landing; placeholder legal pages
  Fixes worth remembering: libsodium standard build lacks `crypto_pwhash` → use sumo · Vite envDir
  must point at repo root · strictPort against CORS drift · orphaned node processes on Windows hold
  ports after task stop — kill PIDs.

### ✅ M2 — Social graph (DONE — awaiting user browser review)

Backend (23 tests in `apps/api/src/http/social.integration.test.ts`; 53 API tests total green):

- `GET /search/users` — username/display-name contains, block-filtered both ways, relationship +
  can-send flag per row, keyset cursor on username
- Friend requests: send (privacy-gated: `friends` setting requires a mutual; 20-pending-outgoing
  cap → 409), accept (tx: request flip + friendship upsert), reject, cancel; `GET /friend-requests`
  by direction; `GET /friends` (cursor) + `DELETE /friends/:userId`
- `GET /friends/suggestions` — friends-of-friends ranked by mutual count (excludes pending/blocked)
- Blocking §10.2: `POST/DELETE /blocks`, `GET /blocks`; block cancels pending requests in-tx,
  hides both users from each other's search/friends; blocked side gets 404 on profile/requests
  (untraceable); friendship survives block so unblock restores it
- Invites §10.3: `POST /invites` (stable per-user code), `GET /invites/:code` (public);
  `register(inviteCode)` auto-sends a friend request to the inviter (best-effort, never fails signup)
- `GET /users/:username` — §8 visibility (public/friends/private → details+stats or minimal card),
  email/birthdate only when owner opted in, mutual count, stat triple posts/friends/**pendingSent**
  (Scope §13.4)
- Notification rows (`friend_request`/`friend_accept`) + `notification:new` emit via `lib/io.ts`
  (io handle set at boot; no-op under supertest). Notification center UI is M7.

Frontend:

- `/people` hub (nav link added): Search (debounced 300 ms, inline actions), Suggestions,
  Requests (received/sent), Friends — cursor "show more", skeleton/empty/error states everywhere
- `/u/:username` profile: visibility-aware details, stat triple, add/cancel/accept buttons,
  remove-friend + block confirm modals, unblock state; Settings → Blocked tab to review/unblock
- `/invite/:code` guest landing (inviter card → register with `?invite=`, signed-in fallback);
  "Invite friends" button uses `navigator.share` with clipboard fallback
- `RelationshipButton` drives every action from the server's relationship enum; TanStack Query
  mutations invalidate the whole `['social']` family (socket invalidation lands in M3)

### ⬜ M3 — Messaging core (NEXT)

- Conversation create (friendship-gated); per-conversation AES-256-GCM content key generated
  client-side, wrapped per member → `ConversationMember.wrapped_key`
- `message:send` (client_uuid + ciphertext → persist, assign sequence, fan out), `message:ack`
  → MessageStatus; sent/delivered/read; mutual read-receipt opt-out; unread counts
- Cursor-paginated history; reconnect gap-replay (client sends last sequence); offline queue with
  pending/failed/retry UI; group chats + per-member delivery breakdown; typing; presence/last-seen

### ⬜ M4 — Messaging polish

- Edit/delete (for me / for everyone) live; reactions; GIFs/stickers; big single emoji
- Reply-to with scroll-to-original; forward (friends-only picker); starred messages view
- Attachments end-to-end (document/image/video/audio/camera, client compression, 10 MB cap)
- Link-safety interstitial; pin/mute/archive; per-conversation drafts; client-side in-chat search;
  chat wallpaper

### ⬜ M5 — Status, live, presence

- 24-h statuses (text/photo, visibility, CC0 music, canvas annotation) + expiry sweep job
- Status/live rail (distinct rings, live first); WebRTC 1:1 calls (STUN→TURN, short-lived coturn
  creds via `TURN_SHARED_SECRET`); mesh live broadcast; active-users counter
- **Manual step**: user provisions Oracle VM + coturn per `infra/coturn/README.md`

### ⬜ M6 — Posts & feed

- Post create (hashtags for public profiles), likes/comments/saves (transactional counters),
  Liked/Saved views, hashtag pages with ranking score (pure fn in `packages/shared`, unit-tested),
  explore feed (cursor infinite scroll), @mentions, share to conversation / external with invite
  note, visibility per profile privacy

### ⬜ M7 — Notifications, account, moderation, admin

- In-app notification center + Web Push (VAPID — **manual step**: generate keys)
- Reports → admin moderation queue (warn/remove/suspend/dismiss); admin route + JWT claim
- Admin analytics dashboard (Recharts; AnalyticsEvent aggregates only — no chat access)
- Deactivate (login restores) vs soft-delete (restoration flow); data export; real ToS/Privacy copy
  (**manual**: user supplies)

### ⬜ M8 — Non-functional hardening

- Rate limiting everywhere + X-RateLimit headers (base exists in `rate-limit.ts`)
- LRU caching w/ invalidation; Workbox offline service worker; skeleton/empty/error sweep;
  keyboard/a11y/reduced-motion audit; sitemap/robots; full seed data; Artillery socket sanity;
  Playwright e2e (signup→friend→chat→post); <300 ms list endpoints

## Environment / provider state

| Item                           | Status                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase `DATABASE_URL`        | ✅ in `.env`, migrations applied (`init`, `m1_auth_tokens_and_user_flags`)                                                              |
| JWT secrets                    | ✅ dev values in `.env` (regenerate fresh ones in Render at deploy)                                                                     |
| Turnstile site + secret        | ✅ working                                                                                                                              |
| Cloudinary                     | ✅ working (avatar upload signed path)                                                                                                  |
| Brevo                          | ⚠️ key in `.env` is an **SMTP** key (`xsmtpsib-`) — REST needs an **API** key (`xkeysib-`); until swapped, emails print to API terminal |
| VAPID / TURN / deploy accounts | ⬜ not needed until M7 / M5 / deploy                                                                                                    |

## Working agreements

- Run app: user runs `pnpm dev` themselves (agent background servers orphan Windows processes)
- Tests: `pnpm test` from root; API integration tests force-reset the `pulsechat_test` schema.
  Prisma's AI guard blocks that reset when an agent runs it — pass
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="tests use the pulsechat_test schema on the same instance (force-reset per run - user consented)"`
  (covers only the dedicated test schema, per the consented fixed decision above)
- Every milestone: lint + format:check + typecheck + test + build green, small commits, update
  this file, then **stop for user review**

## Session log

- **2026-07-11** — M0 built, reviewed, DB migrated + seeded. M1 built (backend 30 tests, full web
  auth/settings/onboarding); fixed libsodium-sumo, Vite envDir, strictPort/CORS, port move to 8000. Pending: user's final M1 browser walkthrough, then M2.
- **2026-07-12** — M2 built (social graph: search, requests, suggestions, blocking, invites,
  public profiles; 23 new API tests → 53 total; full `/people` + profile + invite UI). No schema
  change needed — M0 schema already covered M2. User dropped markdown versions of both specs into
  the repo root (left untracked; commit if wanted). All gates green. Pending: user browser review
  of M2, then M3.
