# Technical Specification — Chat & Social Web Application

Implementation blueprint · Version 0.1 · Last updated July 11, 2026 · Derived from Requirement Scope v0.3

> **Cost constraint carried forward:** every component below runs on a permanently-free tier or self-hosted-free option. Where a provider is named, it is a recommendation, not a lock-in — any equivalent free-tier service can be substituted without changing the architecture.

## Part I — Stack & Architecture

### 1. Technology Stack

| Layer | Choice | Free-tier basis |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS | Open-source, no runtime license cost |
| Offline/PWA | Service worker via Workbox | Browser-native API, no service dependency |
| Backend API + sockets | Node.js + Express + TypeScript, Socket.IO | Self-hosted, no per-connection billing |
| Database | PostgreSQL (Supabase free project) | 500 MB DB + 1 GB file storage, free forever |
| ORM | Prisma | Open-source |
| Auth | Custom JWT (access + refresh) + Argon2id hashing | No paid identity vendor (Auth0, etc.) |
| In-app cache | In-process LRU (node-cache) | Avoids paid Redis tier (Section 20 requirement) |
| Media storage/CDN | Cloudinary free tier | 25 monthly credits, built-in transform/compression |
| Transactional email | Brevo free plan | 300 emails/day — verification, magic link, OTP, new-device confirm |
| CAPTCHA | Cloudflare Turnstile | Unconditionally free, unlimited |
| Push notifications | Web Push API (VAPID keys) | Browser-native, no FCM/APNs cost |
| Calls / live (signaling) | Socket.IO channel (existing realtime layer) | No separate signaling service |
| Calls / live (STUN) | Google public STUN (stun.l.google.com) | Free, no account needed |
| Calls / live (TURN) | Self-hosted coturn on Oracle Cloud Always-Free VM | Genuinely free forever, not a trial |
| Frontend hosting | Vercel free tier | Static + edge, generous free bandwidth |
| API/socket hosting | Render free web service | Free persistent Node process (sleeps when idle) |
| CI/CD | GitHub Actions | Free minutes on free/public repos |
| Uptime monitoring | UptimeRobot free plan | 50 monitors free |
| Analytics | Self-hosted event table + Recharts dashboard | No paid BI/analytics tool |
| DB backups | GitHub Actions cron → pg_dump → Backblaze B2 | 2,000 free CI minutes/mo + 10 GB free storage |
| Status background music | CC0 tracks from Free Music Archive, bundled as static assets | No licensing fee |
| Profanity/spam filter | Open-source wordlist (e.g. "bad-words" npm package) | No paid moderation API |

### 2. System Architecture

Four independently-deployed, all-free components:

> React SPA (Vercel) → HTTPS/WSS → Node API + Socket.IO server (Render) → Postgres + file storage (Supabase) | peer WebRTC media negotiated via Socket.IO signaling, relayed through self-hosted coturn (Oracle VM) when a direct peer connection isn't possible

- The SPA is a single build; there is no separate admin frontend — the admin dashboard (Section 13) is a route gated by an admin-only JWT claim.
- Socket.IO runs in the same Node process as the REST API so both share the request-scoped user/session lookup and the in-process cache.
- Media files (attachments, status images, profile photos) never pass through the API server — the client uploads directly to Cloudinary using a short-lived signed upload token issued by the API.
- The database is the single source of truth for message state (Section 21.2); Socket.IO only carries live notifications of state that is already, or about to be, persisted.

### 3. Repository Structure

```
apps/
  web/        React SPA (Vite, TS, Tailwind)
  api/        Express + Socket.IO server (TS)
packages/
  shared/     Shared TS types, validation schemas (zod), crypto helpers
infra/
  coturn/     TURN server config for the Oracle VM
  github-actions/  CI + scheduled backup workflows
prisma/
  schema.prisma
  migrations/
  seed.ts
```

## Part II — Data & Domain Model

### 4. Core Entities

| Entity | Key fields | Notes |
|---|---|---|
| User | id, username, display_name, password_hash, email, email_verified, birth_date, country, state, bio, avatar_url, visibility (public/friends/private), role (user/admin), status (active/deactivated/deleted), created_at | Soft-delete via status, never hard-erased (Section 16) |
| PrivacySetting | user_id, who_can_send_requests, email_visible, birthdate_visible, last_seen_visibility, status_visibility | 1:1 with User |
| Device / Session | id, user_id, refresh_token_hash, device_fingerprint, user_agent, recognized (bool), last_seen_at, revoked_at | Backs Sections 6.4–6.6 and 16.1 |
| FriendRequest | id, from_user_id, to_user_id, status (pending/accepted/rejected/cancelled), created_at | Capped at 20 pending outgoing per user (Section 20) |
| Friendship | user_a_id, user_b_id, created_at | Symmetric row created on accept |
| Block | blocker_id, blocked_id, created_at | One-directional (Section 10.2) |
| Conversation | id, type (direct/group), name (group only), created_at | Direct conversations require an underlying Friendship |
| ConversationMember | conversation_id, user_id, role (member/admin), joined_at, wrapped_key (Section 6) | wrapped_key implements per-member envelope encryption |
| Message | id, conversation_id, sender_id, ciphertext, nonce, reply_to_id, forwarded_from_id, edited_at, deleted_for_everyone_at, sequence, client_uuid, created_at | sequence + client_uuid give ordering & idempotency (Section 21.2) |
| MessageStatus | message_id, user_id, state (notified/delivered/read), updated_at | Per-recipient row; powers 14.1/14.2 breakdowns |
| MessageReaction / Star | message_id, user_id, emoji (reaction only) | Star has no emoji column, just presence |
| Status | id, user_id, media_url, caption, music_track_id, visibility, expires_at | expires_at = created_at + 24h; swept by a cron job |
| LiveSession | id, user_id, visibility, started_at, ended_at | Row only exists while broadcast is active/just ended |
| Post | id, author_id, media_url, caption, like_count, comment_count, view_count, created_at | Denormalized counters, kept in sync via transaction |
| Hashtag / PostHashtag | tag (unique), post_id | Ranking score = f(likes, comments, avg views) computed at read time |
| Comment / Like / Save | post_id, user_id, body (comment only), created_at | Save is private, never notifies author (13.5) |
| Report | id, reporter_id, target_type (post/message/profile), target_id, reason, status (open/reviewed/actioned), created_at | Feeds admin moderation queue (Section 18) |
| Notification | id, user_id, type, payload_json, read_at, created_at | Drives in-app + push (Section 17) |
| AuditLogEntry | id, user_id, event_type, ip, device, created_at | Owner-visible security log (Section 20) |
| AnalyticsEvent | id, event_type, user_id (nullable), created_at | Raw event stream aggregated for the admin dashboard (Section 18.1) |

Indexes: `users(username)`, `messages(conversation_id, sequence)`, `posthashtag(tag)`, `friendrequest(to_user_id, status)`, `analyticsevent(event_type, created_at)` — ties to Section 20 performance requirement.

## Part III — Security-Critical Design

### 5. Authentication & Session Design

- Passwords hashed with Argon2id (memory-hard, free, no external service).
- Login issues a short-lived JWT access token (~15 min) plus a rotating refresh token stored hashed against the Device/Session row — enables per-device revocation (Section 6.5).
- Magic link: a single-use, time-boxed token emailed via Brevo; opening it exchanges the token for a session, same code path as password login post-verification.
- Email OTP 2FA: 6-digit code emailed via Brevo, checked server-side with attempt limiting.
- New-device flow: device fingerprint (hashed UA + coarse network signal) checked against known Device rows for the account; unrecognized fingerprint creates a "pending" session, emails a confirm link, and only marks the device recognized once clicked (Section 6.6).
- Brute-force protection: exponential backoff + temporary lockout keyed by username+IP, tracked in the same in-process cache used for rate limiting.
- **Remember me (Requirement Section 6.2), unchecked by default:**
  - Unchecked: refresh token issued with a short expiry matching the browser session (no persistent cookie flag) — Device/Session row's expires_at set to session-scope; token is discarded client-side on browser close, same as today's default flow.
  - Checked: refresh token issued with expires_at = now + 30 days and persisted client-side (httpOnly, SameSite=Strict cookie); Device/Session row stores this expiry so the server enforces the 30-day cap independent of the client.
  - Both cases use the identical rotating-refresh-token mechanism already described above — "remember me" only changes the token's lifetime, not its type or storage mechanism, so no new credential class is introduced.
  - The Device/Session list (Section 6.5, GET /auth/devices) surfaces remembered sessions like any other; revoking one immediately invalidates that refresh token server-side, regardless of its remaining 30-day window.
  - Sensitive actions (password/email/privacy changes) always re-prompt for the password via a short-lived step-up check, even on a remembered session — this reuses the existing auth middleware with a re_authenticated_at claim rather than a separate step-up service.

### 6. Encryption-at-Rest Design

Implements Section 20's requirement that message content never be readable server-side, including via direct database access.

- At signup, the client generates an X25519 keypair in-browser (libsodium). The private key is encrypted with a key derived from the user's password (Argon2id, client-side) and stored in IndexedDB; only the public key is sent to the server.
- Each conversation has one AES-256-GCM content key, generated client-side when the conversation is created.
- That content key is wrapped (encrypted) separately for every member using their X25519 public key, and the wrapped copies are stored in `ConversationMember.wrapped_key` — this is why the server can distribute a conversation to N members without ever holding the plaintext key.
- Every message body is encrypted client-side before send; the server stores and relays ciphertext + nonce only.
- In-chat search (Section 14.12) runs entirely client-side over the conversation's already-decrypted, locally-cached messages — the server is never asked to search plaintext.
- Trade-off, stated plainly: losing the password with no recovery email means the private key (and history) cannot be recovered — acceptable for a portfolio-scale project and disclosed in the Privacy Policy.

### 7. Security Controls Checklist

- Input validation on every endpoint via shared zod schemas (`packages/shared`)
- Parameterized queries only (Prisma) — no raw SQL string concatenation, closes SQL injection
- Output encoding + React's default escaping closes reflected/stored XSS; rich text fields are sanitized server-side (e.g. sanitize-html) before storage
- CSRF: SameSite=Strict cookies for refresh token; access token sent as a Bearer header, not a cookie, so classic CSRF doesn't apply to it
- Rate limiting via express-rate-limit backed by the in-process cache, scoped per user/IP per endpoint class (login, message send, friend request)
- Cloudflare Turnstile on signup and login forms
- HTTPS/WSS everywhere — free TLS from Vercel/Render/Let's Encrypt on the TURN VM
- Profanity/spam wordlist filter applied to messages and post captions before storage
- Security audit log (AuditLogEntry) surfaced read-only in Settings → Security

## Part IV — Interfaces

### 8. REST API Surface

| Group | Representative endpoints |
|---|---|
| Auth | POST /auth/register · POST /auth/login (body includes rememberMe: boolean) · POST /auth/magic-link · POST /auth/magic-link/verify · POST /auth/otp/verify · POST /auth/refresh · POST /auth/logout · GET /auth/devices · DELETE /auth/devices/:id |
| Profile | GET /users/:username · PATCH /users/me · PATCH /users/me/privacy · POST /users/me/avatar-upload-token |
| Search & Friends | GET /search/users?q= · POST /friend-requests · PATCH /friend-requests/:id · GET /friends · GET /friends/suggestions · POST /blocks · DELETE /blocks/:id |
| Invites | POST /invites · GET /invites/:code |
| Conversations | GET /conversations · POST /conversations · GET /conversations/:id/messages?cursor= · PATCH /conversations/:id (pin/mute/archive) |
| Messages | POST /messages · PATCH /messages/:id · DELETE /messages/:id?scope=me\|everyone · POST /messages/:id/reactions · POST /messages/:id/star |
| Status & Live | POST /statuses · GET /statuses/feed · POST /live/start · POST /live/end · GET /live/active |
| Posts & Feed | POST /posts · GET /posts/:id · GET /hashtags/:tag?cursor= · GET /feed/explore?cursor= · POST /posts/:id/like · POST /posts/:id/comments · POST /posts/:id/save |
| Notifications | GET /notifications · PATCH /notifications/:id/read · POST /push/subscribe |
| Moderation | POST /reports · GET /admin/reports · PATCH /admin/reports/:id |
| Admin analytics | GET /admin/analytics/summary · GET /admin/analytics/timeseries?metric=&range= |
| Account | PATCH /account/password · POST /account/deactivate · POST /account/delete · POST /account/restore · GET /account/export |
| System | GET /healthz |

All list endpoints accept a cursor + limit and return `{items, nextCursor}`. All responses expose `X-RateLimit-*` headers.

### 9. Real-Time Event Catalog (Socket.IO)

| Direction | Event | Purpose |
|---|---|---|
| Client → Server | message:send | Carries client_uuid + ciphertext; server persists, assigns sequence, then fans out |
| Client → Server | message:ack | Recipient acknowledges delivered/read → written to MessageStatus |
| Client → Server | typing:start / typing:stop | Section 14.10 typing indicator |
| Client → Server | presence:heartbeat | Keeps last-seen fresh |
| Client → Server | call:offer / call:answer / call:ice-candidate | WebRTC signaling relay for calls and live |
| Server → Client | message:new / message:edited / message:deleted | Live fan-out to conversation members' sockets only (Sections 10, 15) |
| Server → Client | message:status | Per-recipient delivered/read update, matches DB (Section 21.1) |
| Server → Client | presence:update | Online/offline + last-seen, filtered by each viewer's visibility rights |
| Server → Client | notification:new | Friend request, acceptance, activity alerts (Section 17) |
| Server → Client | active-count:update | Live active-user counter (Section 12.2) |

On connect, the client sends its last known sequence per open conversation; the server replays any gap from Postgres before resuming live events — the reconciliation step required by Section 21.2.

### 10. Media & File Handling

- Client requests a signed Cloudinary upload token from the API (scoped, short-lived), then uploads directly — the API server never proxies file bytes.
- Images are downscaled/compressed client-side (browser-image-compression) before upload; all file types are hard-capped at 10 MB client-side and re-checked via Cloudinary's upload preset limit.
- Attachment picker (Document/Image/Video/Audio/Camera) all resolve to the same signed-upload path with a type-specific Cloudinary resource_type.
- Image annotation (drawing/stickers) happens client-side on a canvas before the compressed result is uploaded.

### 11. Live Streaming & Calling

- 1:1 voice/video calls: direct peer-to-peer WebRTC, STUN first, coturn TURN relay as fallback when direct connection fails (symmetric NAT, etc).
- Live broadcast: mesh WebRTC (broadcaster connects directly to each viewer) — appropriate at small/demo audience sizes; documented as the scaling ceiling of a free-tier, single-TURN-VM setup rather than a hidden limitation.
- coturn runs as a systemd service on the Oracle Always-Free VM, config in `infra/coturn/`, credentials issued short-lived via the API using the turnserver shared-secret scheme (no static creds baked into the client).

### 12. Notifications

- In-app: Notification rows rendered from a bell menu, marked read on view.
- Push: client subscribes via the browser Push API with a VAPID public key; API stores the subscription and pushes via web-push (npm) directly — no FCM/APNs account needed.
- Covers: friend request received/accepted, new message, account activity alerts (Section 17).

### 13. Content Moderation & Admin Analytics

- Reports (post/message/profile) land in Report with status open; admin console lists open reports, actions = warn/remove-content/suspend/dismiss.
- Admin dashboard reads only AnalyticsEvent aggregates and Report rows — schema-level, the admin role has no query path to Message.ciphertext plaintext, matching Section 18.1's isolation guarantee.
- Metrics: active-now (from presence), DAU/WAU (distinct AnalyticsEvent user_ids per window), total users + growth, traffic over time — charted with Recharts, selectable date range.

## Part V — Delivery

### 14. Performance & Caching Strategy

- Every list endpoint is cursor-paginated (id/sequence-based, not offset) — feed, hashtag pages, search results, chat history.
- Responses are field-scoped per view (no over-fetching) via Prisma select.
- In-process LRU caches hot, frequently-read data (profile summaries, hashtag pages) with short TTLs; invalidated on write.
- Search-as-you-type and typing indicators are debounced/throttled client-side (~250–300ms).
- Postgres indexes as listed in Section 4's footnote.

### 15. Free-Tier Service Directory

| Purpose | Provider | Free limit | If exceeded |
|---|---|---|---|
| Database + storage | Supabase | 500 MB DB / 1 GB storage | Prune old media, archive AnalyticsEvent |
| Media CDN | Cloudinary | 25 credits/mo | Lower default image quality/size |
| Email | Brevo | 300 emails/day | Queue and drip-send, or add a 2nd free provider |
| Frontend hosting | Vercel | 100 GB bandwidth/mo | Switch to Netlify/Cloudflare Pages free tier |
| API hosting | Render | 750 hrs/mo, sleeps when idle | Fly.io free allowance as alternate host |
| TURN relay | Self-hosted coturn (Oracle Always-Free VM) | Bandwidth of the free VM tier | Fall back to STUN-only (fails behind strict NAT) |
| CI/CD | GitHub Actions | 2,000 min/mo (private repos) | Trim workflow frequency |
| Backups | Backblaze B2 | 10 GB storage | Reduce retention window |
| Uptime checks | UptimeRobot | 50 monitors | N/A — well within limit |

### 16. Deployment & CI/CD

- GitHub Actions on push to main: lint → typecheck → unit tests → build → deploy web (Vercel) and api (Render) via their free Git-integration deploy hooks.
- Separate scheduled workflow (nightly cron): pg_dump the Supabase database, upload to Backblaze B2 (Section 21 backup requirement).
- Environment-based config: `.env.development` / `.env.production`, no secret committed to source; secrets live in each host's free environment-variable store.
- UptimeRobot polls GET /healthz every 5 minutes.

### 17. Environment Variables

| Variable | Purpose |
|---|---|
| DATABASE_URL | Supabase Postgres connection string |
| JWT_ACCESS_SECRET / JWT_REFRESH_SECRET | Token signing |
| BREVO_API_KEY | Transactional email |
| CLOUDINARY_URL | Signed upload tokens |
| TURNSTILE_SECRET | CAPTCHA verification |
| VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY | Web Push |
| TURN_SHARED_SECRET | Short-lived TURN credential issuance |
| APP_ORIGIN | CORS + link generation (magic links, invites) |

### 18. Build Sequence

Internal implementation order — the release itself ships as one unit (Requirement Scope Section 22); this is only the order code gets written in.

- **M0 —** repo scaffold, Prisma schema, CI pipeline, health check
- **M1 —** auth (register/login/JWT/sessions), profile, privacy settings
- **M2 —** search, friend requests, blocking, invites
- **M3 —** messaging core: Socket.IO wiring, encryption, send/receive, ordering/reconciliation, read receipts
- **M4 —** messaging polish: edit/delete, reactions, reply/forward, starred, attachments, in-chat search
- **M5 —** status updates, live streaming, presence/active-count
- **M6 —** posts, hashtags, feed ranking, explore, mentions
- **M7 —** notifications (push + in-app), account management, data export, moderation queue, admin analytics
- **M8 —** non-functional pass: rate limiting, caching, offline service worker, empty states/skeletons, accessibility, error pages, seed/demo data

### 19. Testing Strategy

- Unit tests: Vitest, covering validation, encryption helpers, ranking algorithm
- API integration tests: Supertest against a test Postgres instance (Docker locally, ephemeral in CI)
- End-to-end: Playwright (free), covering signup → friend request → chat → post happy paths
- Load sanity check on Socket.IO fan-out before demo, using an open-source tool (artillery) — not a paid load-testing SaaS

### 20. Appendix: Seed & Demo Data

`prisma/seed.ts` creates a small connected graph for local dev and demoing: ~15 users across all three privacy levels, friendships, a handful of conversations with sample encrypted messages, a couple of posts per hashtag bucket, and one open report — enough to exercise every screen without hitting free-tier storage limits.


## Part VI — Post-Handoff Addendum (Requirement Section 24)

> **Impact note:** these are additive to the M0–M8 build sequence (Section 18). None require a new hosting/service tier beyond what Section 15's directory already covers, except Section 24.3 (two new free public APIs). Recommended slot: a new milestone **M9** after M7, since several items (tagging, notification center, comment likes) touch the Post/Notification schema already stabilized in M6–M7.

### 21. Data Model Additions

| Entity / change | Key fields | Backs requirement |
|---|---|---|
| Post.body nullable-media | Post.media_url becomes nullable; caption/body required only when media_url is null | 24.1 Text-only posts |
| Post.audience | New enum column on Post: everyone / friends / only_me | 24.7 Post share audience |
| PostTag | post_id, tagged_user_id, created_at | 24.2 Tag people in posts |
| Comment.like_count / CommentLike | Comment gains like_count; CommentLike(comment_id, user_id, created_at) | 24.6 Comment likes |
| Notification.type additions | New type values: post_like, post_comment, comment_like, tag, friend_request, new_user_suggestion | 24.5 Notification center, 24.6 |
| TrendingMovie / TrendingSong (cache tables) | id, source_id, title, image_url, meta_json, preview_url (song only), fetched_at | 24.3 Trending movies & songs — local cache, not queried live from client |
| PushSubscription.installed_pwa | Boolean flag set when the subscribing client is running in standalone/installed mode | 24.9 PWA — lets notification copy/analytics distinguish installed vs. browser-tab usage |

### 22. Feature Implementation Notes

#### 22.1 Text-Only Posts (24.1)

- POST /posts accepts either media_url or a non-empty caption (zod schema: at least one of the two required) — relaxes the current media-required validation
- Feed/hashtag/profile-grid rendering adds a text-card layout (no image slot) alongside the existing media-card layout; ranking formula (Section 13.2) is unchanged, just fed a view_count of 0/low-weight for text posts since there's no media impression to count

#### 22.2 Tag People in Posts (24.2)

- Composer's tag picker calls the existing GET /search/users?q= endpoint pre-filtered to the caller's Friendship rows (same friends-only scoping already used by the forward-target picker, Section 14.5) — no new search endpoint needed
- POST /posts accepts a tagged_user_ids[] array; server inserts PostTag rows and emits a tag Notification per tagged user in the same transaction that creates the post
- DELETE /posts/:id/tags/me lets a tagged user remove their own tag (author cannot remove another user's tag-removal right)
- Post detail view renders tagged handles from a join on PostTag, linking to /users/:username

#### 22.3 Trending Movies & Songs (24.3)

| Need | Free source | Notes |
|---|---|---|
| Trending movies | TMDB (The Movie Database) API — free API key, no cost tier | GET /trending/movie/day; returns poster path, title, overview |
| Trending songs | Deezer public API (no key required) or Last.fm free API | Deezer's chart endpoint includes a 30-second preview_url per track, satisfying the inline-preview requirement directly |

- A scheduled job (same GitHub Actions cron mechanism as backups, Section 16) hits both APIs on a fixed interval (e.g. every 6 hours) and upserts results into TrendingMovie/TrendingSong — the app's own API never calls TMDB/Deezer on a user request, so client traffic can't blow the free rate limit
- GET /discover/movies and GET /discover/songs serve straight from these cache tables — same shape as every other list endpoint (Section 8), cursor-paginated
- Movie/song detail modal is populated entirely from the cached meta_json, no extra external call on click; song rows render an inline `<audio>` element against preview_url
- Row placement: its own "Trending" section on the Explore screen, visually separated from the post-ranked Explore feed grid (Section 13.7) so the two ranking systems are never conflated

#### 22.4 WhatsApp-Style Message Reactions (24.4)

- Confirms the existing MessageReaction table (Section 4) as one-row-per-(message_id, user_id) with a unique constraint — a new reaction upserts (replacing emoji) rather than inserting a second row, giving the "one active reaction, re-tap removes it" behavior for free at the DB layer
- POST /messages/:id/reactions body {emoji}; same route with emoji omitted / DELETE clears the caller's reaction
- Server emits message:reaction over the existing Socket.IO channel (extends the catalog in Section 9) with the full per-emoji reactor list so all participants' badges/counts update live
- Quick-reaction bar (long-press/hover) is a client-only UI affordance — no new endpoint; "more emoji" opens the same emoji picker already used for composing

#### 22.5 Notification Center (24.5)

- GET /notifications (already in the API surface, Section 8) becomes the single chronological feed backing this screen — no new endpoint, just new type values (Section 21 table above) and richer payload_json per type (post/comment/profile id to deep-link to)
- New-user-suggestion notification: on successful registration, a background job compares the new user's contacts-of-friends graph (mutual-friend heuristic, same signal as Section 10.1 suggestions) against existing users and inserts a new_user_suggestion Notification for likely-to-know accounts, with an inline add-friend action that posts directly to POST /friend-requests
- Unread badge = count of Notification rows with read_at null for the user, pushed live via the existing notification:new socket event

#### 22.6 Comment Likes (24.6)

- POST /comments/:id/like toggles a CommentLike row and increments/decrements Comment.like_count in the same transaction (mirrors the existing Post.like_count pattern, Section 4)
- Emits a comment_like Notification to the comment's author (skipped when liking your own comment)

#### 22.7 Post Share Audience (24.7)

- Post.audience (Section 21) is set at creation from a required composer field, defaulting to the poster's account-level visibility (Section 8) but overridable per post
- Every post read path (feed, hashtag page, explore, profile grid) adds audience to its existing visibility filter: everyone → any viewer; friends → viewer must have a Friendship row with the author; only_me → viewer must be the author
- Hashtag/explore indexing (Section 13.2/13.3) excludes friends and only_me posts at the query level, not just in the UI

#### 22.8 Private-Profile Visit Rules (24.8)

- Profile stats query (post count, friend count — Section 13.4) always runs an unfiltered COUNT, independent of the viewer
- Profile's post grid query applies the Section 22.7 audience filter as normal — for a non-friend viewer this naturally yields only-everyone posts with no special-casing needed beyond the standard filter already being applied everywhere
- No caching subtlety here: because the audience filter is applied per-request (Section 14's in-process cache keys are scoped per viewer, not shared across viewers for any audience-gated query), a newly-accepted friend sees Friends-level posts on their very next request

#### 22.9 Installable Web App / PWA (24.9)

- manifest.webmanifest (name, short_name, icons at 192/512px, theme_color, background_color, display: "standalone", start_url) added to apps/web/public, linked from index.html — zero-cost, browser-native install prompt on Android/desktop Chrome/Edge; iOS Safari uses the same manifest plus the standard apple-touch-icon/meta tags for "Add to Home Screen"
- Builds on the Workbox service worker already required by Section 21 — no second service worker, same install caches app-shell + recently-viewed chat/feed data
- Web Push (Section 12) is verified explicitly against the installed/standalone context, not just an open browser tab, since iOS Safari historically gates Push API availability behind home-screen installation — this is the reason 24.9 calls out re-testing notifications post-install
- QA checklist added to Section 19 (Testing Strategy): install on one real Android device and one real iOS device, verify offline shell load, push delivery, camera/attachment picker (Section 10), and touch-target sizing in standalone mode before sign-off — manual step, no paid device-farm service used
- No separate "installed app" data path: same REST/Socket.IO origin and same JWT/session cookies are used whether launched from the manifest or a browser tab, so state is identical by construction, not by extra sync logic

### 23. Revised Build Sequence (M9)

- **M9 —** text-only posts, post tagging, comment likes, post audience + private-profile visit-rule filtering, notification center consolidation, trending movies/songs (cache job + endpoints + UI), PWA manifest/install/testing pass


## Part VII — Post-Handoff Addendum II (Requirement Sections 24.10–24.15)

### 24. Data Model Additions

| Entity / change | Key fields | Backs requirement |
|---|---|---|
| StatusReply | id, status_id, viewer_id, kind (emoji/text), body, created_message_id, created_at | 24.10 Story replies/reactions — created_message_id links to the DM it materialized as |
| Save (formalized) | Already in Section 4; no schema change, only a dedicated GET /saved endpoint + UI surface | 24.11 Saved/bookmarked posts |
| CloseFriend | owner_id, friend_id, created_at (unique on owner_id+friend_id) | 24.12 Close Friends list |
| Status.audience extension | Status.visibility enum gains a close_friends value alongside everyone/friends | 24.12; also added to Post.audience (Section 21) for posts |
| StatusPoll / StatusPollOption / StatusPollVote | StatusPoll(id, status_id, question, is_open_question); StatusPollOption(id, poll_id, label); StatusPollVote(poll_id, option_id nullable, voter_id, text_answer nullable, created_at) | 24.13 Polls & questions in stories — option_id null + text_answer set = open-question answer |
| Friendship.anniversary_notified_year | Int column on Friendship, last year a nudge was sent | 24.14 — prevents duplicate nudges if the sweep job reruns same day |
| LiveViewer | live_session_id, user_id, joined_at, left_at (nullable) | 24.15 Live viewer list/count — row lifetime = one viewing session |
| LiveComment | id, live_session_id, user_id, body, created_at | 24.15 Live comments |
| Notification.type additions | New values: status_reply, status_reaction, poll_vote, question_answer, friend_anniversary | 24.10, 24.13, 24.14 |

### 25. Feature Implementation Notes

#### 25.1 Story Replies & Reactions (24.10)

- Reply/react UI calls a single POST /statuses/:id/reply {kind, body}; server first checks the viewer is within the status's audience (everyone/friends/close_friends — same guard as viewing it), then creates a direct Conversation (or reuses the existing one) between viewer and poster and inserts a Message carrying the reply, exactly like any other DM — no separate reply data path to keep in sync
- StatusReply row is a thin audit/link record only (status_id → created_message_id) so the status view can show "12 replies" and the poster can jump straight into chat from the status screen
- Emoji-only reaction reuses the same endpoint with kind: "emoji" — it is still a real DM (matches the requirement's "becomes a direct message" language), just typically a one-emoji message

#### 25.2 Saved / Bookmarked Posts (24.11)

- No new table — this formalizes the existing Save entity (Section 4) and POST /posts/:id/save endpoint (Section 8) into its own first-class surface: GET /saved (cursor-paginated, like every other list) plus a "Saved" entry point in the profile menu
- Save/un-save never touches Notification or any counter visible to others, matching the privacy requirement

#### 25.3 Close Friends List (24.12)

- PUT /me/close-friends {friend_ids[]} replaces the caller's CloseFriend rows in one transaction (simplest correct semantics for a small, privately-curated list)
- Visibility check order for close_friends-scoped content: viewer must already be an accepted Friendship AND have a CloseFriend row owned by the poster — same evaluation point as the existing friends-only check (Section 12/24.7), just one extra join
- No audit trail, no Notification, and the list is excluded from every admin/analytics query — enforced by simply never joining CloseFriend into anything but the owner's own visibility checks

#### 25.4 Polls & Questions in Stories (24.13)

- POST /statuses accepts an optional poll: {question, options[]} (2+ options) or {question, isOpenQuestion: true} — creates the Status plus its StatusPoll/StatusPollOption rows in one transaction
- POST /statuses/:id/poll/vote {optionId} for a closed poll, or {textAnswer} for an open question; both insert a StatusPollVote gated by the same audience check as 25.1
- Open-question answers additionally emit a question_answer Notification and are viewable inline on the poster's own status detail (not a DM like 24.10, since the requirement keeps aggregate results in the status view) — voters remain visible only to the poster, never to other viewers
- Poll results are computed at read time (COUNT grouped by option_id) — no denormalized counters needed at this scale

#### 25.5 Friendship Streaks & Anniversary Nudges (24.14)

- Daily scheduled job (same GitHub Actions cron pattern as status-expiry sweep and trending-content refresh) scans Friendship rows whose created_at month/day matches today and anniversary_notified_year != current year
- For each match, inserts one friend_anniversary Notification per side of the friendship and sets anniversary_notified_year, so a rerun same day is a no-op
- Explicitly no new counters, scores, or streak-length tracking — the job only ever needs Friendship.created_at, nothing else

#### 25.6 Live Viewer Visibility & Comments (24.15)

- Joining a live view emits a live:viewer-join socket event (extends the catalog, Section 9); server upserts a LiveViewer row (joined_at) and broadcasts an updated live:viewer-count to the room; leaving/disconnect sets left_at and decrements the same way
- live:viewer-list request returns current watchers (LiveViewer where left_at is null) for the broadcaster's "who's watching" panel — restricted server-side to the session's owner only
- Comments use a lightweight live:comment socket event, persisted to LiveComment and fanned out to everyone currently in the room; unlike chat messages, live comments are plaintext (ephemeral, room-scoped, not private DM content, so the encryption-at-rest requirement in Section 20 doesn't apply) and are pruned along with the LiveSession row once the broadcast ends
- All of the above is gated by the live session's existing audience setting (friends/everyone, Section 12) — the same membership check used to allow a socket into the room at all

### 26. Revised Build Sequence (M10)

- **M10 —** story replies/reactions (DM bridge), saved-posts surface, close friends list, story polls/questions, friendship anniversary nudge job, live viewer list/count + live comments
