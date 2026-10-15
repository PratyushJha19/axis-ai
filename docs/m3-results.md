# M3 implementation and verification results

Date: 2026-10-13. Scope: messaging and notification delivery only. No M4 executor,
AI tools, deployment, paid provisioning or real provider send was performed.

## Implementation

- Twilio WhatsApp Sandbox/production configuration seam and Resend transactional email adapters, fixed provider endpoints, finite timeout, normalized accepted/sent/delivered/read/failed/unknown states, escaped HTML and plain text.
- One channel outbox attached to the existing M2 scheduler. Atomic claims and fenced leases, attempts persisted before HTTP, occurrence/channel identity, bounded safe retries, query-only reconciliation, configurable fallback and late-callback preservation.
- Owner-scoped notification preferences, incoming-code phone proof, STOP, explicit channel consent, verified Google email evidence, immutable queued consent/destination checks, fixed-content channel tests and persistent rate limits.
- Signed account/message-bound callbacks outside browser authentication. Twilio official verifier; raw-body Svix verification followed by JSON parsing. Duplicate events and older states do not erase delivery evidence.
- Notifications dashboard settings/history/details and reminder links, quiet/focus handling, matching-mode worker health and owner-only operational counts.

## Files changed

| Area               | Files                                                                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema             | `database/migrations/005-notifications.ts`, `database/scripts/migrator.ts`, `packages/database/src/index.ts`                                                                                                                                                                                                                |
| Contracts/domain   | `packages/shared/src/notifications.ts`, `packages/shared/src/reminders.ts`, `packages/domain/src/notifications.ts`, `packages/domain/src/notification-provider.ts`, `packages/domain/src/reminders.ts`                                                                                                                      |
| API/auth           | `services/api/src/notification-routes.ts`, `app.ts`, `main.ts`, `auth.ts`, `routes.ts`, `reminder-routes.ts`                                                                                                                                                                                                                |
| Worker             | `services/worker/src/delivery.ts`, `engine.ts`, `provider.ts`, `main.ts`, `health.ts`                                                                                                                                                                                                                                       |
| Dashboard          | `apps/web/src/Notifications.tsx`, `Reminders.tsx`, `App.tsx`, `styles.css`                                                                                                                                                                                                                                                  |
| Tests/recovery     | `tests/unit/notifications.test.ts`, `tests/integration/notification-scenarios.ts`, `delivery-crash-fixture.ts`, `database.test.ts`, `tests/e2e/notifications.spec.ts`, `reminders.spec.ts`, `scripts/check-persistence.ts`                                                                                                  |
| Configuration/docs | `.env.example`, `package.json`, `package-lock.json`, `README.md`, `AXIS_COMPLETE_SPECIFICATION.md`, `docs/00-master-context.md`, `docs/08-implementation-roadmap.md`, `docs/11-m3-messaging-notifications.md`, `docs/decisions/architecture-decisions.md` (ADR-018), `docs/runbook.md`, `docs/threat-model.md`, this report |

Migration 005 adds preferences, phone link challenges, notification jobs, webhook
event deduplication and persistent rate windows; extends existing attempts and
channel constraints; adds `users.email_verified_at`; advances schema readiness to 5. Existing records are preserved. Old users must authenticate again for email
verification evidence. No real application database was migrated by verification.

## Verification

- `npm run format` and `npm run check`: formatting, ESLint, both TypeScript
  checks and all **27 unit/security tests passed**.
- `npm run build`: production frontend build passed.
- `npm audit --audit-level=high`: **0 vulnerabilities**, run with the final
  dependency lockfile before the last source-only fixes.
- `./scripts/verify-local.ps1`: **53 PostgreSQL tests passed**, including 17 M3
  scenarios, clean/upgrade migrations and existing M1/M1.5/M2 regressions.
  Isolated database `axis_test_a8e3bcdd2b50` retained for inspection. A real
  PostgreSQL stop/start preserved core records, reminders, encrypted AI settings,
  chat and uncertain requests, delivery evidence and transport attempts.
- `./scripts/verify-local.ps1 -Browser`: **6 browser tests passed** in 31 seconds,
  including notification preference persistence, mobile layout, mock-mode send
  restrictions and existing dashboard/AI/multi-user/reminder flows. Isolated
  database `axis_test_e2e_d618a9c59a21` retained. The 390px notification screenshot
  was visually inspected; controls and text fit without horizontal overflow.
  Live delivery is not included in the automated counts.

Issues found during verification were corrected: Svix v2 verifies without returning
parsed JSON; payload parsing must follow successful verification. Importing only
Twilio's verifier avoids unnecessary startup work. Dashboard screens were fetching
unrelated core records on notification and settings screens;
those redundant requests were removed while preserving the limit. Initial restricted
loopback and local PostgreSQL startup failures were rerun with appropriate local
execution permissions; they are not counted as passes.

The mobile notification test initially attempted to click the desktop sidebar
after switching to a narrow viewport. Its viewport assertion now runs after
the settings persistence checks. Channel tests also reject missing provider
configuration before enqueuing; the API regression asserts that no job is created.

## Run and configure

`npm ci`, then `npm run dev` for migration/build/API; run `npm run dev:worker` in a
second terminal. Open localhost:3000. `npm run worker:health` checks the worker.
For separate startup: `npm run db:migrate`, `npm run build`, `npm run dev:api`.
Keep `NOTIFICATION_MODE=mock` unless deliberately enabling real delivery. Both
processes use the same PostgreSQL and notification mode.

The full variable list and exact callback/setup instructions are in
[M3 operations](11-m3-messaging-notifications.md). Required live additions are
`NOTIFICATION_MODE`, `WHATSAPP_SANDBOX_MODE`, `NOTIFICATION_PUBLIC_ORIGIN`, the
selected `TWILIO_SANDBOX_*` or `TWILIO_PRODUCTION_*` credentials/sender/template,
and `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`. No secrets are included
in this report. Existing `REMINDER_*` settings control the worker's finite budgets.

## Remaining limitations and review boundary

- **Live WhatsApp and email acceptance: pending.** A provider account, joined Sandbox
  participant, appropriate template/window, verified sending domain, reachable signed
  callback endpoint and explicit recipient consent are external setup requirements.
- Cross-channel duplicate delivery is possible when WhatsApp confirmation is late.
  Unknown sends without a provider reference need a valid callback or manual review;
  they are never blindly retried. Email acceptance does not mean delivery/read.
- Failed recurring occurrences pause for attention. Settings changes invalidate
  queued consent snapshots, and neither cancellation nor opt-out can recall a send
  that has already crossed the dispatch boundary.
- Local capacity limits are conservative. Provider availability, domain reputation,
  production onboarding, public hosting and backup/restore remain separate gates.
- No Git repository exists in this workspace, so no commit or PR was created.

Stop here for M3 review. M4 is not authorized by this report.
