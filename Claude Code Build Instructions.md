# Build Instructions for Claude Code — Chat & Social Web Application

Handoff brief · Version 1.0 · July 11, 2026 · Governs implementation against Requirement Scope v0.3 and Technical Specification v0.1

> **Read this first, in order:** (1) _Web App Requirement Scope_ — the product spec, what the app must do and why. (2) _Technical Specification_ — the chosen stack, data model, API/socket contracts, and build sequence. (3) This document — how to execute that build: what you (Claude Code) own end-to-end, what the human must do outside the codebase, and the engineering bar every line of code is held to. Do not start writing code before both reference documents have been read in full and a folder structure has been planned against Technical Specification Section 3.

## 1. What This Project Is

A real-time chat-and-social web application: one-to-one and group messaging with encryption at rest, friend-based social graph, 24-hour status updates, live streaming, and an Instagram-style posts/feed with hashtags — plus a moderation queue and an admin analytics dashboard that never sees private chat content. A portfolio/learning build, single release, built entirely on free services (Section 2). Full functional detail lives in the Requirement Scope; full architectural detail lives in the Technical Specification. This document tells you how to build against them.

## 2. Free Services In Use

Every part of this build runs on a permanently free tier — no trials, no paid upgrades at any point. This is the complete list; do not introduce a service outside it without checking it's genuinely free forever.

| Purpose                                                                 | Service                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| Database + file storage                                                 | Supabase                                                  |
| Media CDN / transforms                                                  | Cloudinary                                                |
| Transactional email (verification, magic link, OTP, new-device confirm) | Brevo                                                     |
| CAPTCHA                                                                 | Cloudflare Turnstile                                      |
| Push notifications                                                      | Web Push API (VAPID) — no FCM/APNs                        |
| Call/live signaling                                                     | Socket.IO (existing realtime layer)                       |
| STUN                                                                    | Google public STUN                                        |
| TURN                                                                    | Self-hosted coturn on an Oracle Cloud Always-Free VM      |
| Frontend hosting                                                        | Vercel                                                    |
| API/socket hosting                                                      | Render                                                    |
| CI/CD                                                                   | GitHub Actions                                            |
| Uptime monitoring                                                       | UptimeRobot                                               |
| Analytics                                                               | Self-hosted event table + Recharts (no BI tool)           |
| DB backups                                                              | GitHub Actions cron → Backblaze B2                        |
| Status music                                                            | CC0 tracks (Free Music Archive), bundled as static assets |
| Profanity/spam filter                                                   | Open-source wordlist (no paid moderation API)             |

## 3. What Claude Code Owns, End to End

Build the entire product per the Technical Specification's stack and milestone order (Sections 1–3 and 18): repo scaffold, database schema and migrations, every REST endpoint and Socket.IO event, all authentication and encryption logic, the full React application for every screen in the Requirement Scope, and the admin dashboard. Concretely:

- **Backend:** Express + TypeScript API, Socket.IO real-time layer, Prisma schema/migrations/seed script, JWT + Argon2id auth, magic-link and email-OTP flows, envelope-encryption plumbing for messages, rate limiting, caching, validation, moderation queue, analytics aggregation, health-check endpoint.
- **Frontend:** the full React SPA — auth screens, onboarding tour, profile & privacy settings, search, friend system, chat (1:1 and group, with every feature in Requirement Scope Section 14), status/live rail, posts/feed/hashtags/explore, notifications, settings, admin dashboard route, offline service worker, custom error/404 pages.
- **Client-side crypto:** keypair generation, per-conversation content-key wrapping/unwrapping, client-side in-chat search over decrypted history (Technical Specification Section 6).
- **Infra-as-code:** CI/CD workflow files (lint/typecheck/test/build/deploy), the scheduled backup workflow, coturn config files for the TURN VM, environment-variable templates (.env.example), seed/demo data script.
- **Tests:** unit tests for validation/encryption/ranking logic, API integration tests, Playwright end-to-end happy paths, an Artillery load-sanity script for Socket.IO fan-out.

Follow the milestone order M0–M8 in Technical Specification Section 18 unless a dependency forces reordering — each milestone should be a working, demo-able increment, not a partial slice.

## 4. What Must Be Done Manually (Outside Claude Code)

Claude Code cannot create accounts, click through provider consoles, or hold real secrets. The human owner completes these before or during the build; Claude Code should flag exactly which variables/config it is waiting on.

| Task                                                                                                                                                                              | Why it's manual                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create free accounts: Supabase, Cloudinary, Brevo, Cloudflare (Turnstile), Vercel, Render, GitHub, Backblaze B2, UptimeRobot, Oracle Cloud (Always-Free VM)                       | Account creation, billing-free-tier selection, and identity verification require a human                                                                                |
| Generate and store real secrets (JWT signing secrets, VAPID keypair, TURN shared secret, Cloudinary URL, Brevo API key, Turnstile keys) in each host's environment-variable store | Secrets must never be generated or committed by an agent into source; they're pasted into provider dashboards by the owner                                              |
| Provision and harden the Oracle VM, install/configure coturn as a systemd service, open the required ports                                                                        | Requires SSH access to real infrastructure the agent doesn't have accounts for                                                                                          |
| Point a domain (or use the free subdomains) and confirm HTTPS/WSS certificates are issued                                                                                         | DNS control lives outside the repo                                                                                                                                      |
| Write and legally review the actual Terms of Service and Privacy Policy copy (Requirement Scope Section 19)                                                                       | Legal content is a human/editorial decision, not a coding task — Claude Code should build the pages and wire the consent checkbox, with placeholder copy clearly marked |
| Select/license the small CC0 music-track set for status backgrounds (Technical Specification's Free Music Archive line)                                                           | Curation and license-file verification is a judgment call                                                                                                               |
| Send a real test email to confirm verification/magic-link/OTP emails land and don't hit spam                                                                                      | Requires a live inbox and a live Brevo sending domain                                                                                                                   |
| Run the actual first deploy, click through Vercel/Render project linking, and confirm the live URLs                                                                               | One-time interactive setup in each provider's console                                                                                                                   |
| Perform final manual QA on real devices/browsers (camera capture, push notification permission prompts, WebRTC across real NATs)                                                  | Needs physical devices and real network conditions an agent can't simulate                                                                                              |
| Periodically watch usage dashboards (Section 2) and act on the fallback for any service approaching its free limit                                                                | Ongoing operational monitoring, not a one-time build step                                                                                                               |

Everything else — CI workflow files, coturn config, the .env.example template — is Claude Code's job; only account creation and secret-pasting are manual.

## 5. Before Writing Any Code

- Read the Requirement Scope and Technical Specification documents in full — every section, not a skim. Both are the source of truth; this brief only governs process and engineering bar.
- Propose the concrete folder structure before generating files, expanding Technical Specification Section 3 down to real module boundaries (e.g. how `apps/api` splits into routes/services/repositories). Get this right once, up front — restructuring mid-build is expensive.
- Confirm the Prisma schema against Technical Specification Section 4 entity-by-entity before generating the first migration.
- Stub out the environment-variable list (Technical Specification Section 17) as `.env.example` immediately, so the human knows what to provision in parallel with early milestones.

## 6. Backend Engineering Expectations

- **Latency:** typical API responses under 1 second; paginated list endpoints under 300ms server-side at seed-data scale. Anything slower needs a query/index/cache explanation, not a shrug.
- **Socket robustness:** Socket.IO configured with automatic reconnection (backoff, not a tight retry loop), a resync-on-reconnect step that replays any missed sequence from Postgres before resuming live events (Technical Specification Section 9 footnote), and graceful handling of a socket that never reconnects (message queues client-side, per Requirement Scope Section 21.2).
- **Ordering & idempotency:** every message write path enforced by `sequence` + `client_uuid`, duplicate sends detected and no-op'd, never reordered on the wire or in the client cache.
- **Layering:** routes/controllers stay thin; business logic lives in services; data access lives in repositories/Prisma calls — no query logic embedded in route handlers, no business rules embedded in the ORM layer.
- **SOLID & clean code:** single-responsibility modules, dependency injection over hard imports where it aids testability, small functions with one clear job, no god-files. Favor explicit code over cleverness.
- **Validation everywhere:** every request body/query/param validated against a shared zod schema (Technical Specification Section 7) before it reaches business logic — reject early, reject with a clear error shape.
- **Security is not optional:** parameterized queries only, output sanitization on rich text, rate limiting per endpoint class, brute-force backoff on auth, HTTPS/WSS only, no secret ever hardcoded — read from environment config exclusively.
- **Comments & logs:** every non-obvious function has a short doc comment explaining intent (not restating the code); structured logs (level, event, correlation/request id) at entry/exit of significant operations — especially auth, encryption, and socket fan-out — so a failure can be traced without attaching a debugger.
- **Error handling:** a single centralized error-handling middleware producing a consistent JSON error shape; no bare `try/catch` that swallows and returns 200.
- **Tests travel with the code:** a feature isn't done until its unit/integration tests exist per Technical Specification Section 19 — not deferred to a later milestone.

## 7. Frontend Engineering Expectations

- **Modern, interactive UX:** optimistic UI on sends/likes/reactions (reconciled against the server response), smooth micro-animations on state changes (message arrival, reaction pop, like), no dead-feeling clicks — every interactive element gives immediate visual feedback.
- **Color & theming handled correctly:** a real design-token layer (Tailwind theme config, not scattered hex values), light/dark mode both fully styled — not just background-swapped, accent color genuinely themeable per Requirement Scope Section 14.9, WCAG-AA contrast honored in both modes.
- **Skeletons, not spinners:** every data-driven view (feed, chat, profile, search, notifications) shows a content-shaped loading skeleton on first load and on pagination fetch — this is explicitly first-class per Requirement Scope Section 20, not a nice-to-have.
- **Empty, loading, and error states designed for every view** — never a blank screen, never a raw stack trace surfaced to the user.
- **Accessibility:** full keyboard nav, visible focus rings, semantic roles/labels on custom components (chat bubbles, modals, the attachment picker), respects `prefers-reduced-motion`.
- **Responsive by default:** this is a responsive web app (Requirement Scope Section 3) — every screen works from small mobile widths up through desktop, chat and feed layouts reflow rather than just shrinking.
- **State management:** server state (feed, chat, profile data) via a query/cache layer (e.g. TanStack Query) with cache invalidation tied to socket events; local/UI state kept separate and minimal; no prop-drilling through more than two or three levels — lift into context or a store when it does.
- **Componentization:** shared primitives (button, input, avatar, modal, skeleton, toast) built once and reused everywhere — no copy-pasted markup across screens for the same UI pattern.

## 8. Coding Standards & Process

- TypeScript strict mode on both apps; no `any` without a comment explaining why it's unavoidable.
- Consistent naming: PascalCase components, camelCase functions/variables, kebab-case file names for non-component files — match whatever convention is picked in the first commit and never mix conventions within a module.
- Shared types/schemas live once in `packages/shared` and are imported by both apps — never duplicated by hand between frontend and backend.
- Lint + format enforced in CI (ESLint + Prettier); a PR/commit that fails lint or typecheck is not done.
- Small, reviewable commits with descriptive messages tied to a milestone/feature, not one giant commit per milestone.
- No dead code, no commented-out blocks left in place, no `console.log` debugging left in committed code (use the structured logger instead).

## 9. Definition of Done (Per Milestone)

A milestone (Technical Specification Section 18) is not complete until:

- Every requirement it covers, per the Requirement Scope section(s) it maps to, is implemented — not stubbed.
- Its endpoints/events are covered by the tests described in Section 19 of the Technical Specification.
- Its screens have loading, empty, and error states, and pass a basic keyboard-only walkthrough.
- Lint, typecheck, and CI all pass green.
- Any new environment variable it introduces is added to `.env.example` and flagged to the human as a manual provisioning step (Section 4 of this document).
