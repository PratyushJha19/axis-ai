# Telegram commands — verification report

Date: 2026-10-21. Scope: private linked Telegram task/reminder commands, shared
approval-gated changes, optional webhook ingress and independent command worker.
Permanent deletion remains in the authenticated dashboard by owner decision.

## Changed files

- `database/migrations/013-telegram-commands.ts`: durable inbox/reply queues,
  link-bound proposal associations and backward-compatible approval digest for
  narrow internal changes. `database/scripts/migrator.ts` registers it;
  `packages/database/src/index.ts` requires schema 13.
- `packages/shared/src/chat-actions.ts`, domain `action-policy.ts`, `approvals.ts`,
  `chat-actions.ts`, `reminders.ts`: version-bound rename/completion and reminder
  cancellation/next-attempt changes through the existing approval transaction.
  Model chat drafts still accept creation only.
- Domain `telegram-commands.ts`, `telegram.ts`, `notification-provider.ts`: command
  validation, per-user limits, link identity, opt-in settings and exact previews.
- `services/api/src/notification-routes.ts`: authenticated bounded webhook,
  recovery/readiness guard and transport metadata.
- Worker `telegram-commands.ts`, `telegram-main.ts`, `telegram-poller.ts`, `main.ts`:
  durable command processing, independent BYOK inference, reply dispatch receipts,
  uncertainty handling, retention and mutually exclusive polling/webhook mode.
- `scripts/start-free-host.ts`, `scripts/telegram-webhook.ts`, `package.json`:
  optional supervised command process and explicit operator webhook setup helper.
- `scripts/backup-lib.ts`: schema 12/13 backup compatibility; restored queued
  command/reply uncertainty and invalidated Telegram confirmation bindings.
- `apps/web/src/Approvals.tsx`, `Notifications.tsx`: correct change previews and
  webhook/command guidance in the existing interface.
- Tests: new unit/integration/browser Telegram command scenarios; migration and
  backup fixture updates in existing tests.
- `.env.example`, README, SETUP_GUIDE, master context, ADR-029, threat model,
  Telegram/free-host guides and the new `telegram-commands.md` setup guide.

No dependency was added. No production configuration or database was modified.

## Commands and actual results

- `npm run check`: formatting, lint and both TypeScript checks passed;
  **55 unit/security tests passed, 0 failed** on the final run.
  An initial restricted run blocked four local HTTP tests with EACCES; rerunning
  with localhost access passed. These were environment failures, not suppressed tests.
- `npm run build`: passed, 2016 modules transformed.
- `./scripts/verify-local.ps1`: **120 integration tests passed, 0 failed** in
  `axis_test_71f7e42e59fb`, then again in `axis_test_bfb26d8819df` after tightening
  Telegram receipt validation. Includes clean migration, legacy approval integrity,
  all existing M1–M6 regression scenarios and ten new command scenarios.
- Initial PostgreSQL startup exceeded the old helper's timeout. Ran
  `powershell.exe -NoProfile -File scripts/start-local-postgres.ps1`, waited for
  the existing cluster's automatic recovery, then ran isolated verification.
  No cluster reset, reinitialization or user-data deletion was performed.
- `./scripts/verify-local.ps1 -Browser`: **12 browser tests passed, 0 failed** in
  `axis_test_e2e_3bb0eb6fa3f1`. Covers existing dashboard flows and the new exact
  target/version approval preview and execution.
- Focused backup verification using `node --env-file=.local/test.env --import tsx
--input-type=module` to invoke `backupScenarios` through `node:test`: **5 tests
  passed, 0 failed**, after adding restored command/reply invalidation. The helper
  creates isolated fixture databases and never restores over the source.
- `git diff --check`: passed.
- Final focused Telegram verification, using the same Node test entry point style
  in a fresh `axis_test_telegram_*` database: **11 tests passed, 0 failed** (ten
  scenarios plus their parent). Includes preserving a timed task's existing due
  date during rename; PostgreSQL timestamps are normalized before validation.
  Formatting, lint and TypeScript were checked again for this adjustment.

The final approval-screen rebuild also passed the single
`telegram-commands.spec.ts` browser scenario (1 passed, 0 failed).

## Acceptance evidence and boundaries

Tests prove no creation before confirmation, duplicate/concurrent command
idempotency, account isolation, ignored group/forwarded input, 24-hour expiry,
rejection, permanent-deletion denial, stale-target denial, timezone conversion,
reminder changes through existing dispatch guards, unlink suppression, unknown
reply timeout without resend, interrupted-inference fencing and authenticated
webhook durability/recovery quarantine. Existing worker process-crash tests and
reminder/approval uncertainty tests continue to pass. Model/provider calls in
verification are mocked; no real Telegram or AI request was made.

Manual acceptance remains: register the real webhook, verify Render cold-start
delivery and memory headroom with three processes, link each user, check one
command/confirmation and a scheduled reminder, and verify actual BYOK model
interpretation. The setup helper is type-checked but has not changed live bot
configuration. Natural language drafts new tasks/reminders only; structured
commands handle the implemented edits. Requests are independent, with no Telegram
conversation memory. Other application features remain in the dashboard.

Command replies use at most one provider send attempt. Confirmed provider refusal
is failed; timeout/crash is unknown. Inspect `/status`, Approvals and the actual
record before issuing a new mutation. A failed/unknown reply does not undo a
committed internal action. A queued command abandoned during processing may need
a new user request after inspection; no claim of exactly-once external delivery
or always-on free hosting is made. No deployment, paid service, live message or
calendar change was performed.
