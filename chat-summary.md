# gsc-chat — Chat Summary (Updated)

This repo is a Next.js (App Router) + TypeScript SaaS that connects Google Search Console (GSC) via Google OAuth and answers natural-language questions with a strict V2 answer framework.

## Core stack

- Next.js App Router, TypeScript, runtime `nodejs`
- Auth/session: `iron-session` cookie (`SESSION_COOKIE_NAME = "gsc-chat"`)
- Postgres: accessed via `@vercel/postgres` (connection via `POSTGRES_URL`)
- Google APIs: `googleapis` (OAuth2 + Search Console)
- LLM: `openai` tool calling (model in codebase: `gpt-4.1-nano`)

## Login + user persistence

- Login is “Continue with Google” (OAuth).
- OAuth start: `app/api/auth/google/route.ts`
  - Stores CSRF `session.oauthState = crypto.randomUUID()` and redirects to Google with scopes:
    - `https://www.googleapis.com/auth/webmasters.readonly`
    - `openid email profile`
- OAuth callback: `app/api/auth/google/callback/route.ts`
  - Validates `state` vs `session.oauthState`
  - Exchanges `code` for tokens and requires `refresh_token`
  - Verifies identity via `id_token` (`oauth2.verifyIdToken`) and extracts:
    - `sub` (google subject), `email`, `name`
  - Upserts canonical user in DB (`users`) and sets session source-of-truth:
    - `session.userId = users.id` (uuid)
  - Creates/ensures the `usage` row for the user
  - Stores GSC tokens in `gsc_tokens` keyed by `userId` (uuid stored as text)

## Database tables

### Existing token table (created lazily)

- `gsc_tokens` (created by `lib/db.ts:initDb()` if missing)
  - `user_id` (PK, text), `refresh_token`, `access_token`, `expiry_date`

### Paywall + Stripe schema (migration)

- Migration: `migrations/001_paywall.sql`
  - `users` (canonical user table)
    - `id uuid`, `google_sub`, `email`, `name`, `created_at`
  - `usage` (free questions + pending question)
    - `questions_used`, `pending_question`
  - `stripe_customers`, `subscriptions`, `stripe_events` (webhook idempotency)

### Admin role schema (migration)

- Migration: `migrations/002_admin_role.sql`
  - Adds `users.role text NOT NULL DEFAULT 'user'` with allowed values `('user','admin')`
  - Adds `users_role_idx` on `(role)`

## Entitlements + gating

- Centralized entitlements: `lib/entitlements.ts:getUserEntitlements(userId)`
  - Default: Free users get 3 successful answers total
  - `admin` users:
    - `isAdmin = true`
    - treated as `isPro = true` regardless of Stripe subscription status
    - bypass the free-limit/paywall logic (no paywall, no usage increment)

## Stripe subscription ($9/mo) + paywall behavior

- Checkout session: `POST /api/stripe/checkout` (`app/api/stripe/checkout/route.ts`)
- Webhook: `POST /api/stripe/webhook` (`app/api/stripe/webhook/route.ts`)
  - Idempotency via `stripe_events`
  - Handles subscription created/updated/deleted and updates `subscriptions`
- “Success” verifier (one-time on redirect): `POST /api/stripe/checkout-success`

Paywall flow:
- `POST /api/chat` checks entitlements *before* running OpenAI/GSC tools
- If free limit reached (not pro): saves `usage.pending_question` and returns `{ type: "paywall" }` without tool calls
- After successful payment: `/app?checkout=success` syncs subscription and auto-runs `pending_question`

## Chat: V2 answer framework + multi-comparison support

- Chat route: `app/api/chat/route.ts`
  - Allows 0–3 tool calls (`gsc_query`); no longer enforces exactly one tool call
  - For analytical questions, pulls both current preset range and previous period (same length) and uses deltas
- V2 contract renderer + synthesis: `lib/answerFramework.ts`
  - Always renders:
    1. Summary (1–2 sentences)
    2. Key findings (4–8 bullets)
    3. Likely causes (3–6 bullets)
    4. Recommended actions (3–7 numbered steps with [High/Medium/Low impact])
    5. What stands out: (1 sentence)
    6. Confidence (High/Medium/Low + 1 sentence)
- Contract test: `scripts/test-v2-answer-contract.js` (`npm test`)

## Admin features

- Admin-only page: `/app/admin` (`app/app/admin/page.tsx`)
  - Server-side guard: non-admin redirects to `/app`
  - Shows users (email, name, created_at, role, questions_used)
- Admin API: `POST /api/admin/set-role` (`app/api/admin/set-role/route.ts`)
  - Body: `{ email, role: "user" | "admin" }`
  - Admin-only enforced on server
  - Refuses to demote the currently logged-in admin user

## Convenience scripts

- `npm run migrate`
  - Runs `migrations/001_paywall.sql` and `migrations/002_admin_role.sql` by default
  - Supports SQL with dollar-quoted blocks (e.g. `DO $$ ... $$;`)

## Notes

- Next.js warns that `middleware.ts` convention is deprecated in favor of “proxy” (the app still builds/runs).
