# M3 Telegram replacement

Date: 2026-10-15. Scope: replace active WhatsApp notification delivery with Telegram;
no M4, deployment, bot provisioning or real messages.

## Implementation

- Migration 006 adds per-user Telegram destinations, bot binding, explicit consent,
  hashed single-use expiring link challenges, polling cursor and lease. Preserves
  old WhatsApp records and disables legacy dispatch; optional fallback defaults off.
- A fixed-endpoint Telegram adapter uses bounded requests, plain text, destination
  validation, bot identity binding, composite message identity and paid broadcast
  disabled. Explicit 429 rejections retry with bounded backoff; ambiguous outcomes
  remain unknown with no blind resend or invented status lookup.
- The independent worker polls getUpdates under a database lease. Account changes,
  deduplication and cursor advancement commit together. Private human chats only;
  groups, unrelated text and bots cannot link or execute actions. Poll errors are
  content-free, backed off and do not stop scheduling or delivery.
- Telegram success is **sent**, never delivered/read. The scheduler settles that
  occurrence and advances recurrence. Email is optional; confirmed Telegram sends
  suppress fallback while failures/unknowns retain the existing bounded policy.
- Dashboard uses Telegram linking, opt-in, disconnect, fixed tests, polling health
  and existing history. API mutations retain session, Origin, CSRF and owner checks.

## Files

Migration `database/migrations/006-telegram.ts`; migration registry/readiness;
`packages/domain/src/telegram.ts`, `notifications.ts`, `notification-provider.ts`;
shared notification contracts; API notification routes; worker poller, main,
delivery, scheduler and provider outcome contracts; Notifications and Reminders UI;
Telegram unit/integration tests and notification browser/legacy regression fixtures;
`.env.example`, setup docs, README, roadmap, master context, threat model and ADR-019.
The historical Twilio adapter and callback verification remain for old records and
regression coverage, but the application worker removes its credentials and cannot
dispatch new WhatsApp messages. API rejects new WhatsApp linking/enabling/testing.

## Verification

- `npm run check`: formatting, lint, both TypeScript checks and **31 unit/security
  tests passed**. The final retired-credential configuration guard was also checked
  after this run.
- `npm run build`: passed.
- `./scripts/verify-local.ps1`: **62 PostgreSQL tests passed**, including nine
  Telegram scenarios, two-session Telegram API isolation, legacy upgrade safety,
  existing M1/M1.5/M2/M3 regressions and real worker/API process recovery tests.
  Final isolated database: `axis_test_54f4c1f2fd18` (retained).
- `./scripts/verify-local.ps1 -Browser`: **6 browser tests passed** in 19.4 seconds.
  Database: `axis_test_e2e_0e61df55e007`. The 390px Notifications screenshot was
  visually checked and fits without horizontal overflow.
- `npm audit --audit-level=high`: **0 vulnerabilities**. No dependencies added.

This run reused an already-running PostgreSQL cluster; it verified connection
restart and process/lease recovery, not a new full PostgreSQL stop/start. No live
Telegram call has been made. One initial security test was denied loopback access
by the execution sandbox; its authorized rerun passed, not counted as an initial pass.
The development database and private `.env` were not modified by verification.

## Limits

- Standard bot messaging is currently free within Telegram limits, not guaranteed
  forever. AXIS sends at most 10/user/minute and 30/provider/minute; paid broadcasts
  are explicitly disabled. Host/network costs and optional email are separate.
- No delivery/read receipts or lookup of an uncertain send; exactly-once external
  delivery is not claimed. A crash after API acceptance but before DB persistence
  can remain unknown. Users must inspect their Telegram chat in that case.
- Local process availability is required. Polling uses short bounded requests with
  a durable offset; Telegram only retains incoming updates for 24 hours.
- Migration does not rewrite completed mock reminders or automatically send old
  WhatsApp reminders through Telegram. Link/consent and a new schedule are required.
- Live acceptance pending. Stop at this M3 revision for review.
