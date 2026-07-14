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

### ✅ M7 — Notifications, account, moderation, admin (DONE — awaiting user browser review)

Schema: additive migration `m7_suspended_status_and_restore_token` — `UserStatus` gains `suspended`
(admin-only moderation lock, distinct from self-service `deactivated`/`deleted` so a suspended user
can't self-restore via login or the restore-email flow) and `AuthTokenType` gains `account_restore`.

Backend (17 new tests across `notifications.integration.test.ts`, `moderation.integration.test.ts`,
`admin-analytics.integration.test.ts`, plus 3 account-lifecycle cases folded into
`auth.integration.test.ts`; 112 API tests + 17 shared tests total):

- `GET /notifications` (cursor), `PATCH /notifications/:id/read`, `POST /notifications/read-all`
  (§12 "marked read on view" — the bell calls this once on open) — the `notify()` helper that's been
  writing rows since M2 now also drives this API.
- `POST/DELETE /push/subscribe` + `push.service.ts` (`web-push` npm) — ships safe without the VAPID
  manual step (every call no-ops until both keys are set, same pattern M5 used for TURN); `notify()`
  now also fires a push per call. New-message push is **push-only, no Notification row** — the chat
  unread badge already covers in-app history, so this exists purely to close the gap for recipients
  with no live socket (`chat.service.ts` `sendMessage`, tagged by conversationId so the OS collapses
  repeats instead of stacking one per message).
- `POST /reports` + admin queue (`GET/PATCH /admin/reports`, `PATCH /admin/users/:id/status`) —
  action matrix warn/remove/suspend/dismiss; admin list DTO never carries message ciphertext (post
  reports get a plaintext preview since posts aren't encrypted; message reports get only
  `{conversationId, sender}`), keeping the "admin cannot read chat content" guarantee literal.
  `adminDeleteMessage`/`adminDeletePost` reuse the existing tombstone/delete paths minus the
  sender/owner-only check.
- `analytics.service.ts` — one instrumentation call site (`track('session_start', ...)` inside
  `issueSession()`, the single choke point every login/register/magic-link/OTP path already funnels
  through) drives DAU/WAU + traffic; `GET /admin/analytics/summary` + `/timeseries` bucket in-memory
  over a capped 90-day window (same "computed at read time" trade-off as M6's ranking). Growth-over-
  time reads `User.createdAt` directly rather than a redundant signup event.
- `account.service.ts` — `POST /account/deactivate|delete` (password-confirmed, revokes every
  session including the current one), `POST /account/restore/request|confirm` (email-token flow,
  mirrors password-reset), `GET /account/export` (profile + posts + own messages' ciphertext+metadata
  as one JSON download, with an explicit note that only the original device's key can decrypt the
  ciphertext — same documented limitation as M3's "no keys on this device" state, not a new one).
- Bug caught by the new tests and fixed: `auth.service.login()` checked for `deleted` but never
  `suspended` — a suspended user could log straight back in. Fixed before this milestone shipped.

Frontend:

- `features/notifications/`: bell in the nav (unread badge, same shape as the chats badge),
  `use-push.ts` (registers `apps/web/public/sw.js` — a minimal hand-written service worker, not
  Workbox; M8 can extend the same file for offline caching without conflict).
- `features/admin/`: `/admin` console (JWT-role-gated route, no separate SPA per Technical Spec §1)
  with a reports queue and a Recharts analytics dashboard (stat tiles + a single-line timeseries,
  metric/range selectors).
- `features/reports/`: a reusable report modal wired into the message action menu, post card, and
  profile page (each non-own target only).
- Settings gained **Notifications** (push opt-in toggle) and **Account** (export/deactivate/delete,
  password-confirmed) tabs; guest-accessible `/restore-account` + `/restore-account/confirm` pages
  mirror the existing email-token landing-page pattern.
- Legal pages already existed and are linked (M1) — real ToS/Privacy copy stays a tracked manual
  item, not a coding task.

All gates green: lint, format, typecheck, 112 API tests + 17 shared tests, both builds.

### ✅ M8 — Non-functional hardening (DONE — awaiting user browser review, last milestone)

No schema migration. Ten heterogeneous work-streams; a pre-build survey found rate limiting and
`prefers-reduced-motion`/focus-visible styling already close to complete, while caching, seed
content, and e2e/load tooling were genuinely missing (two explicit TODOs sitting unactioned in
`prisma/seed.ts` since M0).

Two scope decisions made with the user up front: **hand-rolled runtime service-worker caching**
instead of a `vite-plugin-pwa`/Workbox build pipeline (extends `apps/web/public/sw.js` in place,
no new build-time dependency); **Playwright + Artillery stay local-only** (npm scripts, not wired
into GitHub Actions — keeps CI fast, avoids the free tier's 2,000 CI-minutes/month cap on
live-server-dependent checks).

Backend:

- `reportLimiter` (10/15min) on `POST /reports` — the one real gap found in an otherwise-complete
  rate-limiting sweep (every other router already had a limiter).
- In-process caching (`apps/api/src/lib/cache.ts`, `node-cache`, previously unused beyond
  rate-limit/backoff counters): hashtag/explore feeds cache the **viewer-independent recency
  window** only (never the finished per-viewer page — that carries likedByMe/savedByMe and would
  leak one viewer's state to another if cached); profile pages cache **postCount/friendCount**
  only (the same number for every viewer by construction, unlike relationship/mutualCount which
  stay live). Invalidated on the writes that actually change either: post create/delete/like/
  comment, friend accept/remove, block/unblock, and — the bug this caught before it shipped — a
  **profile visibility change**, which silently kept a just-gone-private post in the cached
  hashtag window until a test written for this milestone caught it (`invalidateAllFeedCaches()`
  now clears the whole feed-cache namespace on any visibility flip, since the service has no
  per-tag reverse index to invalidate selectively and visibility changes are rare enough that the
  coarser clear is the simpler correct answer).
- `post.repository.ts`/`social.repository.ts`: the hottest list-endpoint `include`s (`author:
true`, `userA/userB: true`, `fromUser/toUser: true`) narrowed to `select` — they were pulling
  every `User` column, `passwordHash` included, off the wire on every row of every feed/friends/
  requests page for fields nothing ever reads beyond a `UserSummaryDto` (+ `visibility` for the
  post-visibility gate, + `publicKey` for the friends list).
- `prisma/seed.ts`: fixed a real pre-existing bug where seed accounts were **permanently
  unloginable** — `placeholderPasswordHash()` wrote a `seed-placeholder:{sha256}` string that
  `password.service.ts`'s `verifyPassword` explicitly rejects by design, and the old `upsert`'s
  empty `update: {}` meant a real Argon2id hash was never applied to already-existing rows even
  after M1 auth shipped. Every seed account is now genuinely loginable
  (`{username}-dev-password`). Added ~16 posts across hashtag buckets, likes/comments/saves,
  3 statuses, one open report, and a couple of notifications — closing the two TODOs left in the
  file since M0. Conversations/messages are deliberately still not seeded: E2E encryption means
  there's no way to produce server-side-decryptable ciphertext without the real browser keypair +
  password-unlock + IndexedDB flow; the new Playwright spec is the honest substitute; a real
  Node-side idempotency bug (a stray `alreadySeeded` check that scanned _every_ user in the DB,
  not just the named seed accounts, and got tripped by unrelated manually-created browser-testing
  accounts) was caught and fixed while wiring this up.
- `apps/web/public/sw.js` extended in place (still hand-written, not Workbox): `install`/
  `activate`/`fetch` added alongside the existing M7 push handlers — network-first with an
  app-shell fallback for navigations, cache-first for Vite's content-hashed `/assets/*`,
  stale-while-revalidate for everything else same-origin. Never touches cross-origin (API)
  requests or non-GET.
- `robots.txt` + a static `sitemap.xml` (public routes only — deliberately not a dynamic
  per-profile/per-post sitemap, which risked listing friends/private-visibility usernames).
- `artillery/socket-sanity.yml` (+ `artillery-engine-socketio-v3`): logs in as the seed accounts
  round-robin, opens a real socket with the resulting JWT, bursts `presence:heartbeat`. Deliberately
  doesn't simulate paired message-send traffic between virtual users — Artillery VUs are
  independent by design and reliably pairing two into a shared conversation is a heavier lift than
  a connection-capacity sanity check warrants. `pnpm test:load`, local-only.
- `e2e/signup-friend-chat-post.spec.ts` (+ `playwright.config.ts`, root): two real browser
  contexts drive signup → friend request → accept → an actual encrypted chat message (Bob's
  browser fetches ciphertext and decrypts it locally — a real proof, not a mock) → post creation,
  asserted via the profile grid's post-count stat. `pnpm test:e2e`, local-only. Both this and the
  load test require `TURNSTILE_SECRET`/`VITE_TURNSTILE_SITE_KEY` unset for the run (Playwright/
  Artillery can't solve a real Turnstile challenge) and a one-time
  `pnpm exec playwright install chromium`.

Frontend:

- Skeleton/empty/error triad sweep: `notification-bell.tsx` (was plain loading text, no error
  state), `reports-queue.tsx`, `analytics-dashboard.tsx`, `liked-posts-page.tsx`,
  `saved-posts-page.tsx`, `status-rail.tsx` — all now use the existing `Skeleton`/`SkeletonRow`/
  `EmptyState` primitives consistently; no new components.
- a11y: `CallOverlay` and `StatusViewer` were plain `fixed inset-0` overlays with no keyboard path
  at all — added `role="dialog"`/`aria-modal`, initial focus on open, and Escape-to-dismiss
  (scoped to the _ringing_ call states only — an in-call Escape-to-hang-up was judged too
  consequential for a stray keypress). `Modal` and `ImageAnnotator` (already `Modal`-wrapped) were
  already correct for free via the native `<dialog>` element's built-in focus trap/Escape.
  `prefers-reduced-motion` was already global CSS; audited the JS-timed effects (status auto-
  advance, heart-pop) and found nothing that bypasses it.

All gates green: lint, format, typecheck, 114 API tests + 17 shared tests, both builds. This was
the last milestone of the **original** handoff scope — see M9 below for a post-handoff addendum
that arrived afterward.

### ✅ M9 — Post-handoff addendum (Requirement §24) (DONE — awaiting user browser review)

Commit `227c8a4` appended **Part VI / Part IX — Section 24** to both spec docs: nine new/changed
requirements added after the original handoff, arriving once M0–M8 were already built.

Schema: one additive migration `m9_post_handoff_addendum` — `Post.mediaUrl` → nullable,
`Post.audience` enum (`everyone`/`friends`/`only_me`), `PostTag`, `Comment.likeCount` +
`CommentLike`, `TrendingMovie`/`TrendingSong` cache tables, `PushSubscription.installedPwa`.
`Notification.type` stayed a free-form `String` — the new values (`comment_like`, `tag`,
`new_user_suggestion`) needed no migration.

Backend (10 new tests in `m9.integration.test.ts`; 124 API tests + 17 shared tests total):

- **24.1 text-only posts** — `createPostSchema` now accepts caption-only bodies (zod refine:
  at least one of media/caption).
- **24.2 tag people in posts** — `POST /posts` accepts `taggedUserIds[]`, silently dropped to
  actual friends server-side (`filterToFriends`, mirrors the friend-gated forward-picker
  pattern); fires a `tag` notification per tagged user; `DELETE /posts/:id/tags/me` for
  self-removal only.
- **24.3 trending movies & songs** — `trending.service.ts` refreshes TMDB + Deezer on an
  in-process interval sweep (`startTrendingSweep`, same pattern as M5's status-expiry sweep),
  not the GitHub Actions cron originally sketched — simpler and matches this codebase's
  existing sweep idiom. TMDB is optional (no-op until `TMDB_API_KEY` lands, same pattern as
  TURN/VAPID); Deezer needs no key. `GET /discover/movies` / `GET /discover/songs` serve from
  the cache tables.
- **24.4 WhatsApp-style reactions** — turned out to be **already fully correct at the DB/socket
  layer** (M4's toggle/replace + the `message:reaction` delta is sufficient for clients to
  reconstruct the full per-emoji reactor list locally); this item was actually a **frontend-only**
  gap, closed below.
- **24.5 notification center** — new `comment_like`/`tag`/`new_user_suggestion` types +
  `postMediaUrl` in post-related payloads (added after user feedback, so the bell/page can show
  a thumbnail of what was liked/commented/tagged, not just the actor's avatar). New-user-suggestion
  fires from `linkInviteOnRegister` to the **inviter's other friends** — the only concrete graph
  signal available at signup (a brand-new account has no friends of its own yet).
  **Dedup fix (post-ship, from user feedback):** `notify()` now recognizes repeatable
  actor+target events (`post_like`, `comment_like`) and refreshes the existing unread row
  instead of stacking a duplicate when a user likes → unlikes → likes again while the first
  notification is still unread; push only fires for genuinely new rows, not refreshes.
- **24.6 comment likes** — `POST /comments/:id/like`, transactional counter mirroring M6's
  post-like pattern exactly.
- **24.7 post share audience** — every post read path (single post, hashtag/explore discovery,
  profile grid) now applies `Post.audience` on top of the existing account-visibility gate,
  never looser. **Real bug caught by the new tests and fixed before shipping**: the first cut of
  `defaultAudienceFor()` mapped an account-`private` author's posts to `only_me` — but `private`
  and `friends` accounts are already treated identically everywhere else in this codebase
  (`assertProfileVisible` only ever distinguishes public from not-public), so that silently hid
  a private user's posts from their own friends. Fixed: both default to `friends`; `only_me` is
  purely a per-post choice with no account-level equivalent.
- **24.8 private-profile visit rules** — confirmed already correct (profile stats were already
  unfiltered real counts); the only change needed was 24.7's grid-level audience filter, plus a
  test.

Frontend:

- Composer: photo now optional, per-post audience selector (defaults from account visibility),
  friends-only tag picker reusing `GET /friends`.
- Explore page: a "Trending" rail (movies + songs) above the ranked post feed, visually separate
  per the spec's instruction not to conflate the two ranking systems; song rows get an inline
  `<audio>` preview.
- Chat: standalone long-press (touch) / hover (desktop) quick-reaction bar next to the bubble
  (`QuickReactionBar`) — additive to the existing "⋯" menu's emoji row, not a replacement; a
  "who reacted" view on the reaction chips using the conversation's own member list (no backend
  change needed, per the 24.4 finding above).
- Notifications: dedicated `/notifications` page (`NotificationsPage`), deep links per type
  shared with the bell dropdown via `notification-utils.ts`; both now show a small thumbnail of
  the liked/commented/tagged post's photo when the notification carries one.
- Post/comment UI: comment-like button + count, tagged-user handles with a self-remove-tag
  control on `PostCard`.
- PWA: `manifest.webmanifest` + `index.html` link/meta tags + a placeholder `icon.svg` (real
  PNG icons are a tracked follow-up asset, same pattern as M5's placeholder music catalog).
  **Added after user feedback** (the manifest alone only makes the browser _capable_ of
  installing — most users never notice the address-bar icon or dig into the browser menu): a
  visible **"Install app"** button in Settings → Appearance, and a dismissible banner on the
  home page, both driven by a `usePwaInstall` hook capturing `beforeinstallprompt`
  (`features/pwa/`) with manual "Add to Home Screen" instructions on iOS, which never fires that
  event.

Two more fixes from the same user browser-review pass, unrelated to §24 itself but caught while
reviewing M9's chat surface:

- **Chat list preview showing raw envelope JSON for image messages** — `parseEnvelope` now
  defensively unwraps a `type: 'text'` envelope whose `.text` is itself a serialized envelope
  (a historical double-encoding produced exactly this "`{"v":1,"type":"image",...`" garbled
  preview), instead of ever displaying raw JSON as message text.
- **Tap-to-open image viewer** — chat images open a full-screen lightbox (`ImageLightbox`) with
  WhatsApp-style Reply/Forward/Download actions, Escape-to-close and initial focus (same a11y
  pattern M8 used for `CallOverlay`/`StatusViewer`); previously images were inline-only with no
  reply/forward/download affordance once sent.

All gates green: lint, format, typecheck, 124 API tests + 17 shared tests, both builds.

### ✅ M10 — Session hardening & story/social extensions (Requirement §6.2, §24.10–§24.15) (DONE — awaiting user browser review)

Another post-handoff addendum: session-management hardening (§6.2 "remember me") plus six more
social/story features (§24.10–§24.15). Same situation as M9 — new requirement sections landed
after the original build was underway.

Schema: one additive migration `m10_session_and_story_extensions` — `Device` gains
`rememberMe`/`refreshExpiresAt`/`previousRefreshTokenHash`; `StatusVisibility` gains
`close_friends`; new `CloseFriend`, `StatusReaction`, `StatusPoll`/`StatusPollResponse` models.
`Notification.type` needed no migration (free-form `String`, same as every prior addition). Live
viewer list + comments are deliberately **not** persisted — ephemeral socket-only state, same
precedent as typing indicators.

Backend (7 new tests in `m10.integration.test.ts`; 131 API tests + 17 shared tests total):

- **§6.2 remember me** — `loginBodySchema` gains `rememberMe`; `auth.service.ts#issueSession`
  sets `Device.rememberMe`/`refreshExpiresAt` (30d when true, a 24h defense-in-depth cap when
  false); `setRefreshCookie` omits `maxAge` (true browser-session cookie) when false instead of
  the old unconditional 30-day cookie. **Reused/stolen token detection**: when a presented
  refresh hash isn't anyone's _current_ token, it's checked against `Device.previousRefreshTokenHash`
  — a hit means an already-rotated-away token is being replayed, so every device for that user
  gets revoked + an audit entry recorded. **Real bug caught and fixed while writing the tests**:
  a naive version of this flagged the codebase's own documented concurrent-refresh race (two
  simultaneous requests presenting the same pre-rotation token, already CAS-protected) as theft
  and revoked a brand-new legitimate session — fixed with a 5-second grace window, keyed off
  `Device.lastSeenAt`, that only escalates to a revoke once a replay is well outside how long a
  genuine race could ever take. **Step-up re-auth**: new `POST /auth/step-up` (password-
  confirmed) + a `requireStepUp` middleware, applied to the two sensitive endpoints with no
  password gate before — `DELETE /auth/devices/:id` and `POST /auth/otp/disable`
  (`change-password`/deactivate/delete already inline a password check, so they're unchanged).
- **§24.10 story replies/reactions** — `POST /statuses/:id/react` (toggle/replace, mirrors
  `chat.service.ts`'s message-reaction toggle) → `StatusReaction` + `notify('story_reaction')`.
  Replies needed **no new endpoint** — the client sends a normal `message:send` with a new
  `story-reply` envelope kind carrying a story preview, reusing the encrypted chat pipeline
  exactly like M6's `post-share` envelope.
- **§24.11 saved posts** — confirmed already fully shipped in M6 (`Save` model, `/posts/saved`);
  no new work, same as how M9 found §24.4/§24.8 already satisfied.
- **§24.12 close friends list** — `POST/DELETE /close-friends/:userId`, `GET /close-friends`
  (same CRUD shape as `Block`, only accepts an existing friend); `status.service.ts`'s audience
  check extends so a `close_friends`-visibility status/live session is only shown to the author
  or to viewers on the author's `CloseFriend` list (batched via `authorsWhoCloseFriended`, not
  one query per feed row).
- **§24.13 story polls/questions** — `POST /statuses` accepts an optional `poll` object
  (kind/question/options) created transactionally with the `Status`; `POST
/statuses/:id/poll/respond` (one response per viewer, upsert-by-PK) + `GET
/statuses/:id/poll/results` (author-only aggregate tally or raw answers, 403 for anyone else).
- **§24.14 friendship anniversary nudges** — a roughly-daily sweep in `social.service.ts` (same
  `setInterval`-at-boot idiom as `status.service.ts`/`trending.service.ts`, plus one run at
  boot) scans friendships for a `createdAt` month+day match against today and fires
  `notify('friendship_anniversary')` to both members; dedupes against an existing notification
  for the same pair within ~20h so a restart mid-day can't double-fire.
- **§24.15 live viewer list + comments** — `rtc.handlers.ts` gains module-level `liveViewers`
  (broadcasterId → viewer map, same shape/lifecycle as the existing `activeCalls` map) and a
  bounded recent-comment ring buffer per broadcast. A joining viewer now gets a
  `live:viewers-snapshot` of who's already watching plus a replay of recent comments, not just
  future join/comment events; disconnecting without an explicit `live:leave` still prunes the
  viewer and notifies the broadcaster. New friend-gated `live:comment` event, fanned out to the
  `live:{broadcasterId}` room; cleared when the broadcast ends.

Frontend:

- Login page gains a "Remember me" checkbox; a new `StepUpProvider` (mounted in the app shell)
  renders a password-confirm modal whenever a request comes back `STEP_UP_REQUIRED`, used by
  session-revoke and 2FA-disable in `security-section.tsx` via a `runWithStepUp` retry helper.
- `features/social/people-page.tsx`: a "Close Friends" tab (reuses the existing tabbed-list
  pattern) to add/remove from the friends list; `status-composer.tsx` gained a `close_friends`
  visibility option and a poll/question sticker builder.
- `status-viewer.tsx`: a quick-reaction row (toggle, live count), poll voting UI with an
  author-only results panel, and a reply field that finds-or-creates a direct conversation with
  the story's author and sends a `story-reply` envelope through the existing chat-send hook
  (`message-bubble.tsx`, `conversation-list.tsx`, `starred-messages-page.tsx` all gained a
  render case for the new envelope kind).
- `go-live-panel.tsx` / `live-viewer.tsx`: a live viewer-avatar strip and a comment feed + input
  on both the broadcaster and viewer sides; the broadcaster now also joins its own live room so
  it receives the same comment broadcasts the viewers do.
- `features/notifications/notification-utils.ts`: copy + profile deep-links for the three new
  types (`story_reaction`, `story_poll_response`, `friendship_anniversary`) — the bell and
  `/notifications` page pick them up automatically through the existing per-type dispatch.

No new "Pending manual setup" item — every §24.10–§24.15 piece is self-contained (no new
external provider) and §6.2 is pure auth-flow logic.

All gates green: lint, format, typecheck, 131 API tests + 17 shared tests, both builds.

## Environment / provider state

| Item                    | Status                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase `DATABASE_URL` | ✅ in `.env`, migrations applied through `m10_session_and_story_extensions`                                                             |
| JWT secrets             | ✅ dev values in `.env` (regenerate fresh ones in Render at deploy)                                                                     |
| Turnstile site + secret | ✅ working                                                                                                                              |
| Cloudinary              | ✅ working (avatar upload signed path)                                                                                                  |
| Brevo                   | ⚠️ key in `.env` is an **SMTP** key (`xsmtpsib-`) — REST needs an **API** key (`xkeysib-`); until swapped, emails print to API terminal |
| TURN (coturn)           | ⬜ code ships STUN-only-safe (M5 done); Oracle VM provisioning still pending, see below                                                 |
| VAPID                   | ⬜ code ships push-ready (M7 done); keys not yet generated — Web Push is a no-op until they land                                        |
| TMDB                    | ⬜ code ships trending-safe (M9 done); no key yet — sweep skips movies, keeps Deezer songs fresh                                        |
| Deploy accounts         | ⬜ not needed until deploy                                                                                                              |

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
- ⬜ **Playwright browser binary** (needed once, before the first `pnpm test:e2e`) —
  `pnpm exec playwright install chromium`. Not run automatically (see M8: build-script approval
  was deliberately declined for `@playwright/browser-chromium` in `pnpm-workspace.yaml`, so this
  stays an explicit, deliberate step).
- ⬜ **TMDB API key** (needed by M9 §24.3 for trending movies) — free-tier signup at
  themoviedb.org, then `TMDB_API_KEY` in `.env`. Deezer (trending songs) needs no key. M9's
  trending-cache job can ship and be tested against Deezer alone in the meantime, same
  no-op-until-configured pattern used elsewhere in this doc.
- ⬜ **PWA real-device install testing** (needed by M9 §24.9 close-out) — one real Android
  device and one real iOS device: verify install prompt/home-screen icon, offline shell load,
  push delivery in the installed/standalone context, camera/attachment picker, and touch-target
  sizing. Manual step, no paid device-farm service.
- ⬜ **Real PNG app icons** (M9 shipped `apps/web/public/icon.svg`, a simple placeholder mark,
  referenced from both the manifest and `apple-touch-icon`) — Android/Chrome/Edge accept an SVG
  manifest icon fine, but iOS's Add-to-Home-Screen icon support for SVG is inconsistent across
  versions. Swap in real 192px/512px PNGs (plus a dedicated apple-touch-icon PNG) once real
  branding art exists — a data-only asset swap, same pattern as M5's placeholder music catalog.

## Working agreements

- Run app: user runs `pnpm dev` themselves (agent background servers orphan Windows processes)
- Tests: `pnpm test` from root; API integration tests force-reset the `pulsechat_test` schema.
  Prisma's AI guard blocks that reset when an agent runs it — pass
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="tests use the pulsechat_test schema on the same instance (force-reset per run - user consented)"`
  (covers only the dedicated test schema, per the consented fixed decision above)
- Every milestone: lint + format:check + typecheck + test + build green, small commits, update
  this file, then **stop for user review**
- `pnpm test:e2e` (Playwright) and `pnpm test:load` (Artillery) are local-only, manual, not part
  of the standing gate or CI (M8 decision — keeps CI fast, avoids the free tier's CI-minutes cap
  on live-server-dependent checks). Both need `TURNSTILE_SECRET`/`VITE_TURNSTILE_SITE_KEY` unset
  in `.env` for the run — neither tool can solve a real Turnstile challenge.
- **Root-caused and fixed (M8) a connection-pool exhaustion bug that looked like flaky infra for
  two whole milestones.** Supabase's pooler caps session-mode clients at 15 total
  (`FATAL: (EMAXCONNSESSION) ... pool_size: 15`); Prisma's default per-client `connection_limit`
  (~2×CPU cores+1) can approach that alone, and `vitest.global-setup.ts` gave every test file's own
  `PrismaClient` no explicit cap — as the suite grew past ~10 files (M7/M8 added several), running
  the _full_ suite (not a single file) started intermittently exhausting the pool, surfacing as
  30s test timeouts and stray 500s with no pattern tying them to any specific code change. Fixed by
  capping `connection_limit=5` on the test `DATABASE_URL` in `vitest.global-setup.ts` — confirmed:
  114/114 tests green afterward, durations back to single-digit-to-~20s per test, zero flakiness on
  a full-suite run that previously failed ~19 tests. If a _single_ test file run ever times out
  again, it's much more likely a real regression now that this is fixed — don't reflexively blame
  infra.

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
- **2026-07-12 (later still)** — M7 built on user go-ahead (M2–M6 browser review still pending):
  notification bell + Web Push (ships push-ready without VAPID, same no-op-until-configured
  pattern as M5's TURN), moderation queue (warn/remove/suspend/dismiss, admin DTO never carries
  message ciphertext), admin analytics dashboard (Recharts, DAU/WAU from one `session_start`
  instrumentation point in `issueSession()`), and account deactivate/delete/restore/export. One
  additive migration (`m7_suspended_status_and_restore_token`) adds a `suspended` UserStatus —
  deliberately distinct from self-service `deactivated`/`deleted` so an admin suspension can't be
  undone by the user logging back in or using the restore-email flow. New-message push is
  push-only (no Notification row) since the chat unread badge already covers that ground — the bell
  stays scoped to discrete social events. Caught and fixed a real pre-existing bug while writing
  tests: `auth.service.login()` never actually checked for `suspended` status, so a suspended user
  could log straight back in. 17 new API tests (notifications, moderation, admin-analytics, plus
  3 account-lifecycle cases folded into `auth.integration.test.ts`) → 112 API tests, 17 shared
  tests total. All gates green (lint, format, typecheck, tests, both builds). Pending: user browser
  walkthrough of M2–M7, then M8 (non-functional hardening — the last milestone).
- **2026-07-12 (later still)** — M8 built on user go-ahead (M2–M7 browser review still pending):
  the last milestone — rate-limit audit, in-process feed/profile caching with invalidation,
  hand-rolled service-worker runtime caching (not Workbox, by explicit user choice), a skeleton/
  empty/error sweep, an a11y pass on the two overlays that had no keyboard path (`CallOverlay`,
  `StatusViewer`), robots.txt/sitemap.xml, a real seed-data pass, and local-only Artillery +
  Playwright tooling (also by explicit user choice — kept out of CI). Caught and fixed two real
  bugs while building this: (1) profile-visibility changes didn't invalidate the hashtag/explore
  feed cache, so a post could keep appearing in discovery briefly after its author went
  non-public — caught by a test written for this milestone, not by the feature working as
  intended; (2) `prisma/seed.ts`'s seed accounts have been permanently unloginable since M0 (a
  placeholder password hash `verifyPassword` was always going to reject, and the seed `upsert`'s
  empty `update: {}` meant even landing real Argon2id hashing in M1 never fixed already-existing
  rows) — now fixed, every seed account logs in with `{username}-dev-password`. Two new
  integration tests added (feed-cache and profile-count-cache invalidation) → 114 API tests, 17
  shared tests total. Also root-caused and fixed the thing that looked like unexplainable Supabase
  flakiness across this _and_ the M7 session (a socket test timing out at 30 minutes, cascades of
  unrelated 500s on full-suite runs): Supabase's pooler caps session-mode clients at 15, and
  `vitest.global-setup.ts` never capped Prisma's own per-client connection limit — added
  `connection_limit=5` to the test DB URL, confirmed clean on a full 114-test run afterward (see
  "Working agreements" for the detailed diagnosis). All gates green (lint, format, typecheck,
  tests, both builds). Pending: user browser walkthrough of the full app (M2–M8) — the last one,
  since M8 is the final roadmap milestone.
- **2026-07-12 (later still)** — Found that commit `227c8a4` ("test verified") had appended a
  post-handoff addendum (Requirement §24 / Technical Spec Part VI) to both spec docs after M0–M8
  were already built: nine new/changed requirements (text-only posts, post tagging, trending
  movies/songs, richer message reactions, a real notification center, comment likes, per-post
  audience, private-profile visit-rule clarification, PWA installability). Cross-checked each
  against the current codebase and added a planned **M9** section to this file (schema/backend/
  frontend bullets, gap table, two new external deps — TMDB + Deezer) plus two new "Pending
  manual setup" bullets (TMDB key, PWA real-device testing). Planning only — no M9 code written
  yet; M8's own user-review walkthrough is still outstanding and unaffected by this addition.
- **2026-07-14** — M9 built on user go-ahead ("Go ahead to integrate new planed scope"): all
  nine §24 items (text-only posts, post tagging, comment likes, per-post audience + private-
  profile visit rules, notification center additions, trending movies/songs, richer message
  reactions, installable PWA). One additive migration (`m9_post_handoff_addendum`). 10 new API
  tests → 124 API tests, 17 shared tests total. Caught and fixed a real bug the new tests
  surfaced before shipping: an account-`private` author's posts defaulted to post-audience
  `only_me` (visible to no one, not even friends) instead of `friends` — wrong, since `private`
  and `friends` accounts are already treated identically everywhere else in this codebase.
  24.4 (message reactions) turned out to already be correct at the DB/socket layer from M4 —
  only the frontend needed the standalone quick-reaction bar the spec called for. All gates
  green (lint, format, typecheck, tests, both builds).
  User then reviewed the M9 chat/notification/PWA surfaces live and reported three issues, fixed
  in the same session: (1) liking → unliking → liking a post stacked duplicate "X liked your
  post" notifications while the first stayed unread — `notify()` now dedupes repeatable
  actor+target events by refreshing the existing unread row instead; post-related notifications
  also gained a `postMediaUrl` thumbnail. (2) the chat list's last-message preview showed raw
  envelope JSON for an image message (a historical double-encoded envelope) — `parseEnvelope`
  now defensively unwraps a `text`-typed envelope whose own `.text` is itself serialized JSON.
  (3) chat images had no tap-to-view — added a full-screen `ImageLightbox` with WhatsApp-style
  Reply/Forward/Download actions. Separately, the user asked where the "install as app" control
  was — the M9 manifest/service-worker only made installation _possible_, with no visible UI
  trigger — added a real "Install app" button (Settings → Appearance) and a dismissible home-page
  banner, both driven by a new `usePwaInstall` hook capturing `beforeinstallprompt`, with manual
  iOS instructions since Safari never fires that event. Re-ran the full gate afterward (one
  spurious vitest worker crash on a re-run, unrelated to the changes — confirmed clean on retry).
  Pending: user browser walkthrough of the fixes just applied, plus M2–M9 overall — M9 is the
  last roadmap item beyond the original M0–M8 handoff scope.
- **2026-07-14 (later)** — User dropped another batch of new requirements: §6.2 ("remember me"
  session hardening — session-only vs. 30-day refresh tokens, reused/stolen-token revocation,
  step-up re-auth) plus §24.10–§24.15 (story replies/reactions, saved posts, close friends list,
  story polls/questions, friendship anniversary nudges, live viewer list + comments). Checked
  each against the current codebase and added a planned **M10** section to this file — found
  §24.11 (saved posts) already fully shipped in M6, same as M9's discovery that §24.4/§24.8 were
  already satisfied. Planning only — no M10 code written yet; the M2–M9 browser walkthrough is
  still outstanding and unaffected by this addition.
- **2026-07-15** — M10 built on user go-ahead ("Implement M10 plan now"): remember-me session
  hardening (§6.2 — session-only vs. 30-day refresh cookies, reused/stolen-token detection,
  step-up re-auth for session-revoke/2FA-disable), close friends list (§24.12), story reactions
  (§24.10), story polls/questions (§24.13), friendship anniversary nudges (§24.14), and live
  viewer list + comments (§24.15). One additive migration
  (`m10_session_and_story_extensions`). 7 new API tests → 131 API tests, 17 shared tests total.
  Caught and fixed a real bug the new tests surfaced before shipping: the first cut of the
  reused-refresh-token detector flagged the codebase's own documented concurrent-refresh race
  (two simultaneous requests presenting the same pre-rotation token — already handled by the
  existing CAS rotation) as theft and revoked a brand-new legitimate session; fixed with a
  5-second grace window keyed off `Device.lastSeenAt`, confirmed against both the new reuse test
  and the pre-existing concurrent-refresh regression test. Story replies reuse the encrypted
  chat pipeline via a new `story-reply` envelope kind, the same pattern M6 used for `post-share`.
  All gates green (lint, format, typecheck, 131 API + 17 shared tests, both builds). Pending:
  user browser walkthrough of M10, plus M2–M9 overall — M10 is the last roadmap item beyond the
  original M0–M8 handoff scope.
