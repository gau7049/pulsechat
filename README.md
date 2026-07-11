# PulseChat

Real-time chat & social web application — 1:1 and group messaging with encryption at rest, a
friend-based social graph, 24-hour statuses, live streaming, and an Instagram-style posts/feed —
built entirely on permanently-free services. A portfolio/learning build.

Source-of-truth documents (repo root): `Requirement Spec.pdf` (product), `Technical Spec.pdf`
(architecture), `Claude Code Build Instructions.md` (process & engineering bar).

## Stack

React 18 + Vite + TypeScript + Tailwind (Vercel) · Express + Socket.IO + TypeScript (Render) ·
Prisma + PostgreSQL (Supabase) · libsodium client-side envelope encryption · Cloudinary · Brevo ·
Cloudflare Turnstile · Web Push (VAPID) · WebRTC (Google STUN + self-hosted coturn) ·
GitHub Actions CI + nightly backups to Backblaze B2.

## Repository layout

```
apps/web          React SPA
apps/api          Express + Socket.IO server
packages/shared   zod schemas, DTO/socket types, pure helpers (single source of truth)
prisma/           schema, migrations, seed
infra/coturn      TURN server config for the Oracle VM
.github/workflows CI + scheduled DB backup
```

## Getting started

```sh
pnpm install
cp .env.example .env        # fill in DATABASE_URL (Supabase) at minimum
pnpm db:migrate             # create schema
pnpm db:seed                # demo data
pnpm dev                    # api on :4000, web on :5173
```

`pnpm lint · typecheck · test · build` must all pass before a change is done
(Build Instructions §8–9).

## Environment

Every variable is documented in [.env.example](.env.example). Secrets are provisioned manually in
each host's dashboard and never committed. Providers with unset keys fall back to console logging
in development so the app runs before accounts exist.
