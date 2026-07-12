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

### ✅ M3 — Messaging core (DONE — awaiting user browser review)

Backend (10 tests in `apps/api/src/http/chat.integration.test.ts` over real Socket.IO;
63 API tests total):

- Conversations: friendship-gated create (§15, blocks honoured), direct dedupe (either side →
  same room, 200 vs 201), groups w/ name + admin role; add member (admin-only) / leave; members
  carry per-viewer presence (§8 last-seen visibility; last-seen = max `Device.lastSeenAt`,
  refreshed by `presence:heartbeat`; live state in-process in `presence.service.ts`)
- Messages: `message:send` (ack callback returns persisted DTO) — sequence = max+1 with unique
  `(conversation_id, sequence)` retry, `client_uuid` idempotency; fan-out to `user:{id}` rooms;
  recipients with live sockets get MessageStatus `notified`, others stay unreached (§14.2)
- `message:ack {conversationId, upToSequence, state}` — cumulative, monotonic (read never
  downgrades); `message:status` re-broadcast applies the **mutual** read-receipt opt-out per
  receiving member (DB keeps the truth for unread counts; presentation degrades read→delivered)
- `message:sync` gap replay on reconnect (§21.2) — returns everything past the client's last
  sequence per conversation and marks it delivered; typing relay; §10.2 block locks direct convos
- REST: `GET /conversations` (members, myWrappedKey, lastMessage, unreadCount), cursor history
  by sequence, `GET /messages/:id/statuses` (§14.2 breakdown, sender-only)

Frontend:

- Crypto (Tech Spec §6): AES-256-GCM bodies via WebCrypto; content key sealed per member with
  libsodium `crypto_box_seal`; unlocked private key cached in IndexedDB for the session
  (cleared on logout) so silent restore still decrypts; password-unlock panel (magic-link
  logins); explicit "no keys on this device" state — key portability is the documented §6 limit
- `/chats`: two-pane (list + window), unread badges incl. nav total, decrypted last-message
  previews, presence dot / last-seen, typing line, new-chat modal (direct or group; wraps the
  key for every member's publicKey — members without keys are not selectable)
- Window: upward infinite scroll (anchored viewport), read acks while visible, live ticks
  pending → sent ✓ → delivered ✓✓ → read (accent) upgraded via `message:status` watermarks
  (`chat-live-store.ts`), failed + retry, group per-member breakdown modal
- Offline outbox (§21.2): encrypted entries persisted in localStorage, flushed on reconnect,
  then `message:sync` patches React Query caches in place (`use-chat.ts` socket bridge)

### ✅ M4 — Messaging polish (DONE — awaiting user browser review)

Schema: additive `message_hides` table (per-viewer "delete for me" hide, doesn't touch the
row anyone else sees) — migration `m4_message_hides`, no data loss.

Backend (8 tests in `apps/api/src/http/chat-actions.integration.test.ts`; 71 API tests total):

- Edit (`PATCH /messages/:id`, sender-only, not on tombstones) — re-encrypted ciphertext,
  `editedAt`, live `message:edited`
- Delete: `?scope=me` inserts a `MessageHide` row (history + unread queries exclude hidden
  rows for that viewer only); `?scope=everyone` (sender-only) tombstones the row — drops
  ciphertext, sets `deletedForEveryoneAt`, live `message:deleted`; edit/react on a tombstone
  → 409
- Reactions: toggle semantics (same emoji removes, different replaces — one row per user by
  PK), rides on `MessageDto.reactions`, live `message:reaction`
- Stars: private per-user toggle, `GET /messages/starred` (cursor, each row labelled with its
  conversation's display name) — never visible to anyone else
- Reply/forward: `message:send` now accepts `replyToId` (must be in the same conversation)
  and `forwardedFromId` (sender must actually be a member of that message's conversation —
  forwarding is bounded by the friendship-gate, never an arbitrary-user picker per §14.5)
- `PATCH /conversations/:id` pin/mute/archive — per-member flags on `ConversationDto`, never
  affects other members' view of the same conversation
- Signed attachment-upload tokens (image/video/raw) reusing the Cloudinary signing scheme
  from avatars (§10, §14.8) — bytes never touch the API server

Frontend:

- `message-envelope.ts`: versioned JSON payload _inside_ the AES ciphertext (text / sticker /
  image / video / audio / document) — server stays opaque to it; legacy M3 plain-text
  messages still parse as `{type:'text'}`, so no back-compat break
- `attachments.ts`: client-side image compression (skips GIFs to keep animation), 10 MB cap
  enforced pre-upload, direct-to-Cloudinary with progress
- Bubble rewrite: typed rendering per envelope kind, big single-emoji display, §14.7
  link-safety interstitial (never navigates directly), reaction chips, reply quote
  (click → scroll+highlight original), "Forwarded" badge, per-message action menu
  (react/reply/forward/star/edit/delete-for-me-or-everyone with a confirm modal)
- Composer: attachment picker (document/image/video/audio/camera), sticker tray, reply/edit
  modes, §14.11 auto-saved per-conversation drafts (localStorage)
- §14.12 in-chat search runs client-side over already-decrypted cached plaintext only — never
  asks the server to search ciphertext
- Conversation header menu: pin/mute/archive/leave + wallpaper picker (§14.9, device-local
  choice); conversation list groups pinned first, collapses archived, shows a muted icon and
  excludes muted chats from the nav unread badge
- Dedicated `/chats/starred` view (§14.6), cross-conversation, links back to the original chat
- Forward picker reuses the user's own conversations — friends-only by construction, since
  every conversation is already friendship-gated

### ✅ M5 — Status, live, presence (DONE — awaiting user browser review)

Schema: no migration needed — `Status`/`LiveSession` models already existed from M0.

Backend (8 new tests in `apps/api/src/http/status.integration.test.ts` over real Socket.IO,
2 unit tests in `turn.service.test.ts`; 92 API tests total):

- `POST /statuses` (photo and/or caption, everyone/friends visibility), `DELETE /statuses/:id`
  (owner-only), `GET /statuses/feed` — self + friends only, either-way blocks excluded, live
  broadcasters sorted first (§12.1); unpaginated, same friend-count-bounded trade-off as
  `GET /conversations`. In-process 15-min sweep (`status.service.startExpirySweep`, started at
  boot) hard-deletes expired rows; feed queries also filter by `expiresAt` directly so expiry is
  correct between sweeps.
- `POST /live/start` / `POST /live/end` / `GET /live/active` — one active `LiveSession` per user
  (starting a new one ends any prior), persist-then-push `live:started`/`live:ended` to friends
  (mirrors `notification.service.ts`'s shape); a socket-disconnect backstop ends an abandoned
  broadcast immediately, plus a 6h crash-backstop sweep.
- WebRTC signaling (`sockets/rtc.handlers.ts`): `call:invite/accept/reject/end` for 1:1 calls
  (friendship + block gated, in-memory `callId → {caller, callee}` pairing map — no DB entity,
  matches the spec's event-only design) and `live:join/leave` for the mesh broadcast (viewer
  authorization mirrors the feed's friend-gating); `call:offer/answer/ice-candidate` reused
  bidirectionally for both contexts via a `context: 'call' | 'live'` discriminator, pure relay —
  server never inspects SDP.
- `GET /rtc/ice-servers` (`turn.service.ts`) — Google STUN always; short-lived coturn REST-API
  credentials (HMAC-SHA1 per the turnserver shared-secret scheme) added automatically once
  `TURN_HOST`/`TURN_SHARED_SECRET` are set — **STUN-only today**, since the Oracle VM is still
  pending manual setup.
- `GET /presence/active-count?scope=all|friends` (§12.2) — "no one" visibility excluded from both
  scopes per spec text; `presence.service.broadcastPresence` now also emits a scope-tagged
  `active-count:update` **ping** (not a computed number) on every flip, mirroring the client's
  existing `['social']` invalidate-and-refetch pattern instead of maintaining a live counter.

Frontend:

- `features/annotate/image-annotator.tsx` — shared canvas annotator (freehand pen + emoji
  stickers, reusing the composer's `STICKERS` list hoisted to `features/chat/stickers.ts`); wired
  into **both** the new status composer and retrofitted into the M4 chat image-attachment flow
  (`chat-window.tsx`), closing a spec gap M4 shipped without.
- `features/status/`: rail on the home page (self "+" tile, friends with live sorted first, ring
  style differentiates live vs. status per §12.1), full-screen story-style viewer (tap-through,
  auto-advance, deletes own statuses), composer (photo/caption/visibility/placeholder music).
- `features/calls/`: `webrtc.ts` (ICE-servers fetch + peer-connection helpers + ICE-candidate
  queueing ahead of `setRemoteDescription`), `use-calls.ts` (1:1 call state machine + socket
  bridge, ephemeral store outside React Query — same pattern as `chat-live-store.ts`),
  `call-overlay.tsx` (mounted once in `app-shell.tsx` so an incoming call rings on any route),
  `go-live-panel.tsx` / `live-viewer.tsx` (broadcaster keeps one outbound `RTCPeerConnection` per
  viewer — the mesh's documented scaling ceiling). Call buttons added to the direct-conversation
  chat header.
- Home page: replaced the stale M0-era placeholder (still said "M2 next" through M4) with the
  rail, an active-users pill (§12.2, all/friends toggle), and a real recent-chats list — exactly
  what the pre-existing code comment there already earmarked for M5.
- Placeholder status-music catalog (`packages/shared/src/status-music.ts`) — 6 entries, tracks
  point at files that don't exist yet; the viewer treats a 404 as "unavailable" rather than
  failing the status. Real CC0 picks are a data-only swap once chosen.

All gates green: lint, format, typecheck, 92 API tests + 12 shared tests, both builds.

### ✅ M6 — Posts & feed (DONE — awaiting user browser review)

Schema: no migration needed — `Post`/`Hashtag`/`PostHashtag`/`Comment`/`Like`/`Save` already
existed from M0. Posts are **not** E2E encrypted (Technical Spec §6 scopes that to messages only).

Backend (12 new tests in `apps/api/src/http/posts.integration.test.ts`, 5 ranking unit tests in
`packages/shared/src/ranking.test.ts`; 93 API tests + 17 shared tests total):

- `POST /posts` (single required image, caption optional), `GET /posts/:id` (view-count increments,
  skipping self-views), `DELETE /posts/:id` (owner-only), `GET /posts/:id/comments` +
  `POST /posts/:id/comments`, `POST /posts/:id/like` / `POST /posts/:id/save` (transactional
  counters, toggle semantics), `GET /posts/liked` / `GET /posts/saved` (§13.5 Settings views),
  `GET /users/:username/posts` (profile grid).
- **Post visibility reuses `social.service.ts`'s exact profile-visibility gate**
  (`isSelf || author.visibility==='public' || relationship==='friends'`) rather than inventing a
  stricter reading of "private" — invisible posts read as 404, matching the blocked/private-profile
  precedent already shipped in M2.
- Hashtags are parsed from the caption (`#tag`, lowercased) and only indexed when the author is
  currently a public profile (§13.1/§13.3); hashtag/explore reads re-check author visibility live,
  so a public→private switch retroactively drops old posts from discovery.
- `GET /hashtags/:tag` / `GET /feed/explore` — ranking score
  (`likes·3 + comments·2 + (views/ageDays)·1`, `packages/shared/src/ranking.ts`) computed over a
  bounded 300-post recency window, sorted in-memory, then offset-paginated behind the same opaque
  cursor contract as every other list endpoint — a documented "computed at read time" trade-off
  rather than a DB-side scoring expression.
- Like/comment create `Notification` rows (`post_like`/`post_comment`) via the existing `notify()`
  helper — same precedent as M2's friend-request notifications landing before the M7 UI exists.

Frontend:

- `features/posts/`: composer (photo required, reuses M5's `ImageAnnotator` + `uploadAttachment`),
  `PostCard` (like/comment/save/share, owner delete) and `PostThumbnail` (profile grid tile),
  `PostText` (hashtag/@mention linkifier, no link-safety interstitial — that's §14.7's rule for
  messages only), comments panel, and pages for `/p/:id`, `/hashtag/:tag`, `/explore`,
  `/posts/liked`, `/posts/saved`.
- **Share to a chat** reuses the existing E2E message pipeline instead of a new endpoint — a new
  `post-share` envelope kind carries a denormalized preview (media/caption/author) through the
  normal `message:send` path, rendered as a card in `message-bubble.tsx`. **External** share is
  client-only (`navigator.share` + clipboard fallback, mirroring M2's invite-link button) with the
  spec's required invite note, pointing at the `/p/:id` permalink.
- Profile page now shows a posts grid (`GET /users/:username/posts`) below the stats row; the nav
  bar gained a distinct "+" create-post control (§13.1) and an Explore link; Settings → Profile
  links to the two new Liked/Saved views.

All gates green: lint, format, typecheck, 93 API tests + 17 shared tests, both builds.

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

| Item                    | Status                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase `DATABASE_URL` | ✅ in `.env`, migrations applied (`init`, `m1_auth_tokens_and_user_flags`)                                                              |
| JWT secrets             | ✅ dev values in `.env` (regenerate fresh ones in Render at deploy)                                                                     |
| Turnstile site + secret | ✅ working                                                                                                                              |
| Cloudinary              | ✅ working (avatar upload signed path)                                                                                                  |
| Brevo                   | ⚠️ key in `.env` is an **SMTP** key (`xsmtpsib-`) — REST needs an **API** key (`xkeysib-`); until swapped, emails print to API terminal |
| TURN (coturn)           | ⬜ code ships STUN-only-safe (M5 done); Oracle VM provisioning still pending, see below                                                 |
| VAPID / deploy accounts | ⬜ not needed until M7 / deploy                                                                                                         |

## Pending manual setup (owner-tracked, not blocking coding)

Coding for the milestone that needs each of these proceeds without them — STUN-only calling
and a placeholder track list stand in until the real values arrive. Do these whenever
convenient; tell the agent the resulting values/files when ready and it will wire them in.

- ⬜ **Oracle Cloud Always-Free VM + coturn** (M5 shipped STUN-only; this improves call/live
  reliability across strict NATs once provisioned) — steps in `infra/coturn/README.md`, ~30 min.
  Produces `TURN_HOST` and `TURN_SHARED_SECRET` for `.env`; `turn.service.ts` picks them up
  automatically, no code change needed.
- ⬜ **CC0 status background music** (M5 shipped with a 6-track placeholder catalog in
  `packages/shared/src/status-music.ts`) — pick short tracks from Free Music Archive / Pixabay
  Music / Chosic (CC0, no attribution required), drop the files at `apps/web/public/audio/status/`
  - license info in the repo; swapping the catalog's `fileUrl`s is a data-only change.
- ⬜ **VAPID keypair** (needed by M7 for Web Push) — `npx web-push generate-vapid-keys`, then
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VITE_VAPID_PUBLIC_KEY` in `.env`.
- ⬜ **Brevo API key swap** (blocks real email delivery, not local dev — emails currently print
  to the API terminal) — the `.env` key is an SMTP key (`xsmtpsib-`); the REST API Brevo calls
  need an API key (`xkeysib-`) from the Brevo dashboard.
- ⬜ **Real ToS/Privacy Policy copy** (needed by M7 close-out, Requirement Scope §19) — legal
  content is a human decision; placeholder copy is already live and clearly marked.
- ⬜ **First deploy accounts** (Vercel, Render, Backblaze B2, UptimeRobot) — needed at actual
  deploy time, not before, per Build Instructions §4.

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
- **2026-07-12 (later)** — M3 built on user go-ahead (M2 browser review still pending): messaging
  core end to end — socket send/ack/sync with strict ordering + idempotency, E2E envelope
  encryption client-side, presence/typing, offline outbox, full `/chats` UI. 10 new API tests
  (real socket round-trips) → 63 total; no schema change needed. Design note: account keypair is
  device-bound (spec §6) — new devices show a "no keys here" state; session cache of the unlocked
  key lives in IndexedDB, cleared on logout. Pending: user browser walkthrough of M2+M3 (two
  browsers/accounts for live chat), then M4.
- **2026-07-12 (later still)** — M4 built on user go-ahead (M2/M3 browser review still pending):
  messaging polish — edit/delete (both scopes), reactions, reply/forward, starred messages,
  attachments, link safety, pin/mute/archive, drafts, in-chat search, wallpaper. One additive
  migration (`message_hides`). 8 new API tests → 71 total. Model switched mid-session
  (Fable 5 → Sonnet 5) after hitting a usage limit; picked up cleanly from the in-progress
  `chat-window.tsx` rewrite (fixed one bad emoji literal introduced right before the switch).
  All gates green (lint, format, typecheck, 83 tests, both builds). Pending: user browser
  walkthrough of M2+M3+M4, then M5 (status/live/presence — needs the Oracle VM + coturn manual
  step per `infra/coturn/README.md` before WebRTC calling can be tested end to end).
- **2026-07-12 (later still)** — User confirmed manual setup (Oracle VM/coturn, CC0 music) will
  happen later, not before M5 coding. Added the "Pending manual setup" section above so every
  outstanding manual item (M5's two, plus M7's VAPID/legal-copy and deploy-time accounts) is
  tracked in one place instead of scattered across milestone bullets. M5 build is explicitly
  spec'd to proceed STUN-only in the meantime. Next session starts M5.
- **2026-07-12 (later still)** — M5 built on user go-ahead (M2–M4 browser review still pending):
  statuses (photo/caption, visibility, placeholder music, expiry sweep), live broadcasting (mesh
  WebRTC, one `RTCPeerConnection` per viewer), 1:1 voice/video calls (friend-gated socket
  signaling, no DB entity), STUN-only ICE (TURN auto-activates once `TURN_HOST`/
  `TURN_SHARED_SECRET` land), and the §12.2 active-users indicator (ping-then-refetch, not a
  pushed number). No schema migration needed — `Status`/`LiveSession` existed since M0. User chose
  to also retrofit the spec's image-annotation tool into the existing M4 chat-attachment flow
  while building it for statuses, closing a gap M4 shipped without. 8 new API tests + 2 unit tests
  → 92 API tests total; 12 shared-package tests. All gates green (lint, format, typecheck, tests,
  both builds). Pending: user browser walkthrough of M2–M5 (needs two sessions for calls/live —
  same-network is fine since TURN isn't provisioned yet), then M6 (posts & feed).
- **2026-07-12 (later still)** — M6 built on user go-ahead ("go ahead with M6", M2–M5 review still
  pending): posts, hashtags, likes/comments/saves, ranked hashtag pages + explore feed, profile
  posts grid, @mention/#hashtag linkifying, share-to-chat (reuses the encrypted message pipeline
  via a new `post-share` envelope kind) and external share with the spec's required invite note.
  No schema migration needed — every M6 entity existed since M0. Post visibility deliberately
  reuses the exact profile-visibility gate already shipped in `social.service.ts` rather than a
  new interpretation. Ranking is a bounded-window, computed-at-read-time trade-off (documented in
  `post.service.ts`), not a DB-side scoring expression. 12 new API tests + 5 ranking unit tests →
  93 API tests, 17 shared tests total. All gates green (lint, format, typecheck, tests, both
  builds). Pending: user browser walkthrough of M2–M6, then M7 (notifications, account,
  moderation, admin — needs the VAPID keypair manual step for Web Push, tracked in "Pending
  manual setup").
