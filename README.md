# Mailbox

A single-user, installable web mail client (PWA) for `tanakadev.digital`: read and send mail through
Resend, with one-time-code login, no sign-up and no other users.

**Stack:** TanStack Start (React, TypeScript) on Vercel via Nitro · Drizzle ORM + Supabase Postgres ·
Supabase Storage (private) · Resend · Tailwind CSS · Vitest.

## Status

The application is delivered as a stack of pull requests, merged in order:

1. Scaffold, environment validation, database schema and migrations
2. Login (emailed one-time code), sessions, access gate
3. Inbound mail: webhook, threading, sync
4. Inbox UI
5. Compose, reply, reply-all, forward
6. PWA
7. Security hardening and the full documentation (replaces this file)

Setup, environment variables and the Vercel deploy order are documented in the README that arrives
with the last pull request.
