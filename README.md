# Mailbox

A single-user, installable web mail client for `tanakadev.digital`. It reads mail that Resend
receives for the domain (catch-all) and sends mail through Resend. There is no sign-up, no
teams and no other users: login is a one-time code emailed to the owner.

**Stack:** TanStack Start (React, TypeScript) on Vercel via the Nitro Vite plugin · Drizzle ORM +
postgres.js on Supabase Postgres (pooled URL, `prepare: false`) · Supabase Storage (private bucket)
· Resend · Tailwind CSS · Vitest.

Supabase is used only as Postgres and private file storage. Every table has row-level security
enabled and no policies, so the Supabase API roles can read nothing; the app talks to Postgres
directly and to Storage with the service-role key, both from the server only.

## Environment variables

Copy `.env.example` to `.env.local` for local work and set the same names in the Vercel project.
Never commit them. They are validated at startup (`src/env.server.ts`); a bad value fails fast and
the error names the variable, never its value.

| Variable                                    | What it is                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                            | Resend API key (send + receive).                                                                  |
| `RESEND_WEBHOOK_SECRET`                     | Signing secret of the `email.received` webhook. Added _after_ the first deploy.                   |
| `DATABASE_URL`                              | Supabase **pooled (transaction mode)** connection string.                                         |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage access (server only).                                                                     |
| `OWNER_EMAIL`                               | External address that receives login codes. Must not be on `tanakadev.digital`.                   |
| `MAIL_FROM`                                 | Sender for mail you send, e.g. `Name <me@tanakadev.digital>`.                                     |
| `AUTH_FROM`                                 | Sender for login codes, e.g. `Login <login@tanakadev.digital>`.                                   |
| `APP_URL`                                   | Public origin, e.g. `https://mail.tanakadev.digital`. Mutating requests must carry this `Origin`. |
| `DATABASE_POOL_MAX`                         | Optional, connections per instance (default 5).                                                   |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`     | Optional, both or neither. Turns on Web Push notifications. Generate with `npm run vapid`.        |

## Local development

```bash
npm install
cp .env.example .env.local      # fill it in
npm run db:migrate              # applies ./drizzle to DATABASE_URL
npm run db:setup-storage        # creates the private bucket (idempotent)
npm run dev                     # http://localhost:3000
```

To look around without any accounts, `npm run dev:db` starts a throwaway in-memory Postgres with
sample mail and prints a session cookie (Resend and Storage are not emulated). Point `DATABASE_URL`
at `postgresql://postgres:postgres@127.0.0.1:54329/postgres` and set `DATABASE_POOL_MAX=1`.

| Script                                                    | Purpose                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run typecheck` / `lint` / `check` / `test` / `build` | The checks run after every stage.                                      |
| `npm run db:generate`                                     | Generate a migration after editing `src/db/schema.ts`.                 |
| `npm run db:migrate`                                      | Apply migrations.                                                      |
| `npm run db:setup-storage`                                | Create (or confirm private) the `mail-attachments` bucket.             |
| `npm run test:headers`                                    | Live experiment: which custom headers Resend honours (sends one mail). |

## Deploy order (Vercel)

DNS for the domain is already on Vercel and Resend is already verified for sending and receiving.
**Do not touch the MX, DKIM, SPF, DMARC or Resend CNAME records.**

1. **Database and storage.** With `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
   `.env.local`, run `npm run db:migrate` and `npm run db:setup-storage` from your machine.
2. **Create the Vercel project** from this repository (framework is detected; the Nitro plugin in
   `vite.config.ts` produces the Vercel output). Add every variable from the table **except
   `RESEND_WEBHOOK_SECRET`**, with `APP_URL=https://mail.tanakadev.digital`, and deploy.
3. **Add the domain** `mail.tanakadev.digital` to the project (Project → Settings → Domains). Because the
   zone is on Vercel DNS this needs no change to existing records.
4. **Create the webhook in Resend** (Webhooks → Add): event `email.received`, endpoint
   `https://mail.tanakadev.digital/api/webhooks/resend`. Copy its **signing secret**.
5. **Add `RESEND_WEBHOOK_SECRET`** in Vercel and **redeploy**. Until then the endpoint answers 503, so
   Resend keeps retrying rather than dropping mail.
6. Open the app, sign in (the code goes to `OWNER_EMAIL`), and press **Sync** once to backfill anything
   received before the webhook existed. Sync is also the recovery action if the webhook was ever down.

## Acceptance checklist

- [ ] Mail from Gmail to `test@tanakadev.digital` appears within seconds of the webhook firing.
- [ ] A reply sent from the app arrives in Gmail in the same thread.
- [ ] Login works with the emailed code; five wrong codes lock it; logging out ends the session.
- [ ] HTML mail renders with scripts and remote images blocked; **Load images** enables images.
- [ ] The app installs as a PWA on phone and desktop.
- [ ] Replaying the same webhook (Resend dashboard → resend event) creates no second message.
- [ ] `curl -I https://mail.tanakadev.digital/sw.js` shows `cache-control: no-cache…`.
- [ ] Run `npm run test:headers` and read the result (see below).

## Things to verify live

These depend on Resend and Supabase behaviour that could only be checked against their docs and SDK
types, not against your accounts:

- **Custom headers.** The Resend docs do not say whether `In-Reply-To`, `References` and `Message-ID` are
  honoured. `npm run test:headers` sends one mail to `headers-test@<your domain>` and reports, per header,
  `HONORED` or `NOT honored`. Threading does not depend on the answer: replies are matched by header when
  possible and otherwise by normalized subject plus a shared external participant within 30 days.
- **SPF/DKIM/DMARC badges.** The SDK's received-email type has no `authentication` field, so verdicts are
  read from the `Authentication-Results` header (and `Received-SPF`). If a real message shows no verdicts,
  inspect its headers in Resend and adjust `src/server/mail/auth-results.ts`.
- **Browser uploads to Storage.** Attachments are `PUT` straight to a signed upload URL (so the 4.5 MB
  Vercel request limit never applies). `connect-src` allows your Supabase origin. Attach a file in a
  test message once after deploying.
- **Response headers on static files.** Nitro emits header rules into the Vercel route config; confirm with
  `curl -I` on `/sw.js` and `/manifest.webmanifest` after the first deploy.

## Notifications (Web Push)

New mail can raise a desktop notification (sender and subject, click opens the thread) even when the app
window is closed. It works in Chrome and Edge once the app is installed or open in a browser; the browser
must be running (Windows lets Chrome/Edge run in the background).

1. `npm run vapid` prints a key pair. Put **both** lines in the Vercel env vars (never commit them) and redeploy.
2. Run `npm run db:migrate` (adds the `push_subscriptions` table).
3. Open the app, press **Turn on notifications** in the sidebar and allow the browser prompt. **Send a test** checks it.

Notifications are sent from the Resend webhook right after a new email is saved, so they need the webhook
from the deploy steps above. Mail pulled in by **Sync** does not notify. Each browser subscribes separately;
turning notifications off removes its subscription. Rotating the VAPID keys invalidates existing
subscriptions: the app notices and shows the button as off, so press it again.

Privacy: the payload is end-to-end encrypted to the browser, travels through the browser vendor's push service
and contains only sender, subject and a link. Subscription endpoints are only accepted from the push services
of Chrome/Edge, Firefox, Windows and Safari, so the server cannot be pointed at arbitrary hosts. Push failures
never affect saving mail: the webhook still answers 200.

## How it works

**Inbound.** `POST /api/webhooks/resend` verifies the Svix signature on the raw body, ignores other events,
then fetches the full email (the webhook has no body), copies attachments to private Storage (download URLs
expire after about an hour) and writes the message, thread and attachment rows in one transaction under an
advisory lock. It returns 2xx only after saving; anything transient is a 5xx so Resend retries. The same
email id can be processed any number of times.

**Threading.** `In-Reply-To`/`References` are matched to stored `Message-ID`s in both directions (a reply that
arrives before its original still joins). Fallback: same normalized subject (`Re:`/`Fwd:` stripped) and a
shared external participant within 30 days. Your own domain is ignored when matching participants.

**Outbound.** Compose, reply, reply-all and forward send text and HTML. Replies set `In-Reply-To` and
`References` and stay in their thread. Message-ID is derived from a per-draft id, and Resend's idempotency
key is the same id, so a double click or a retry after a partial failure cannot send twice.

**Showing HTML mail.** Sanitized on the server with `sanitize-html`, then rendered only inside an iframe with
`sandbox` (no `allow-scripts`) and its own CSP: no remote images, CSS, fonts, frames or forms. Remote images
load only after **Load images** on that message. Mail HTML is never inserted into the app's DOM.

**Auth.** One button, "Send code". A 6-digit code from a CSPRNG, stored as a hash, valid 10 minutes, single
use, locked after 5 wrong attempts, rate-limited per minute/hour with database counters. Sessions are a random
256-bit token (only its hash is stored) in an `HttpOnly; Secure; SameSite=Lax` cookie with a 90-day sliding
expiry. Every page and server function needs a session except the login routes and the webhook; mutating
requests must carry the app's `Origin`.

**PWA.** `public/manifest.webmanifest`, icons and a hand-written `public/sw.js` (scope `/`). The worker caches
only the static offline page; it never stores authenticated pages, server functions or API responses.

## Security notes

- CSP with a per-request nonce, `X-Content-Type-Options`, `Referrer-Policy`, HSTS, `X-Frame-Options`,
  `Permissions-Policy`; authenticated responses are `no-store`.
- No secret or mail content is logged: errors are reduced to their type and codes (`src/server/log.ts`).
- All input is validated with zod; queries use Drizzle's parameterized builders. `tests/security.test.ts`
  fails the build on raw SQL, stray `console` use, an unreviewed public API route, or a server function
  without input validation.
- `npm audit --omit=dev` reports no vulnerabilities. The remaining audit findings are in `drizzle-kit`'s
  bundled esbuild (a dev-server advisory in a dev-only tool).

## Known limitations

- Files uploaded for a message that is never sent stay under `outbound/tmp/` in the bucket until removed by hand.
- `nitro` is pinned to the 3.x beta that TanStack's installer selects; bump it deliberately.
- Search is prefix-based on subject, text body and sender; it does not search recipients or HTML-only text.

## Layout

```
src/start.ts              global middleware: Origin check, session gate, CSP and security headers
src/env.server.ts         zod-validated environment
src/db/                   Drizzle schema (RLS on every table) and client
src/server/auth/          OTP, sessions, cookies, rate limits, public path list
src/server/mail/          ingest, threading, sync, webhook, compose, send, queries, sanitizer
src/server/*.fn.ts        server functions (all behind the session gate)
src/routes/               login, inbox, thread, compose, search, webhook, attachment download
public/                   manifest, icons, service worker, offline page
drizzle/                  migrations
scripts/                  migrate, setup-storage, test-resend-headers, dev-db
tests/                    Vitest; database tests run the real migrations on in-process Postgres
```
