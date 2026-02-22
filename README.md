This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Local Setup

1) Install dependencies:
```bash
npm install
```

2) Configure Google OAuth + Search Console API:
- Create/choose a Google Cloud project
- Enable the **Google Search Console API**
- Configure the OAuth consent screen
- Create an **OAuth Client ID** (Application type: **Web application**)
- Add this redirect URI exactly:
  - `http://localhost:3000/api/auth/google/callback`

3) Configure environment variables:
- Copy `.env.local.example` to `.env.local`
- Fill in:
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  - `OPENAI_API_KEY`
  - `SESSION_PASSWORD` (32+ chars). Generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

4) Run the dev server:
```bash
npm run dev
```

5) Open:
- `http://localhost:3000`

## Paywall + Stripe (Local + Vercel)

### 1) Run DB migration (Neon / Postgres)

Run this SQL against your database:
- `migrations/001_paywall.sql`

Example with `psql`:
```bash
psql "$POSTGRES_URL" -f migrations/001_paywall.sql
```

### 2) Environment variables

Add these to `.env.local` (and Vercel project env vars):
- `POSTGRES_URL` (your Neon/Postgres connection string)
- `APP_URL` (e.g. `http://localhost:3000` locally; your Vercel URL in prod)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID` (the $9/mo recurring price id)

### 3) Stripe webhook forwarding (Stripe CLI)

Install and login:
```bash
stripe login
```

Forward webhooks to your local dev server:
```bash
stripe listen --forward-to http://localhost:3000/api/stripe/webhook
```

Copy the printed signing secret into `STRIPE_WEBHOOK_SECRET`.

### 4) End-to-end test flow

1. `npm run dev`
2. Open `http://localhost:3000`
3. Click “Continue with Google” to log in (Google OAuth)
4. Ask up to 3 questions for free at `http://localhost:3000/app`
5. On question #4 you should see a paywall; click “Upgrade ($9/mo)” to open Stripe Checkout
6. After successful payment you’ll be redirected back to `/app?checkout=success...` and the saved question will auto-run.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
