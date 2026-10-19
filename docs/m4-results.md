# M4 verification — 2026-10-17

Scope: shared approval gate for internal task/reminder creation, owner-scoped
proposal API, durable lifecycle, inbox and audit. External/high-risk execution,
fresh reauthentication and approval-channel messaging are not implemented.
Full M4 release acceptance is therefore not claimed.

## Files changed

- Migration: `database/migrations/009-approvals.ts`; registered in
  `database/scripts/migrator.ts`. Schema readiness updated in
  `packages/database/src/index.ts`.
- Domain: `packages/domain/src/action-policy.ts`, `approvals.ts`,
  `chat-actions.ts`; shared lifecycle types in
  `packages/shared/src/chat-actions.ts`.
- API: `services/api/src/approval-routes.ts` and `app.ts`.
- UI: `apps/web/src/Approvals.tsx`, `App.tsx`, `styles.css`. Sidebar navigation
  retains its full height so the profile footer cannot cover settings links.
- Tests: `tests/integration/approval-scenarios.ts`, `database.test.ts`,
  `multi-user-scenarios.ts`; `tests/e2e/ai.spec.ts`, `dashboard.spec.ts`,
  `reminders.spec.ts`.
- Test runner: `scripts/verify-local.ps1` starts a separate HTTP server per browser
  spec file, preserving production rate limits while isolating synthetic workflows.
- Documentation: `README.md`, `setup_guide.md`, `docs/00-master-context.md`,
  `docs/12-m4-approval-security-gate.md`, ADR-023 and this report.

## Actual verification

- `npm run check`: passed formatting, lint, both TypeScript checks and all
  **34 unit/security tests**. The first sandboxed run failed on loopback EACCES;
  the authorized local rerun passed.
- `npm run build`: passed.
- `./scripts/verify-local.ps1`: **77 passed, 0 failed** using isolated database
  `axis_test_bd224eebb646`. Verified empty migration chain, upgrade from schema 8
  preserving a completed legacy proposal, migration replay and owner isolation.
  Approval tests cover unapproved execution, altered hashes, policy mismatch,
  unknown/high-risk operation denial, injected authority, idempotent proposal
  creation, concurrent execution, reconnect persistence, audit, cancellation,
  terminal unknown denial and failed-effect rollback. Existing reminder, AI and
  notification recovery scenarios also passed.
- `./scripts/verify-local.ps1 -Browser`: **6 passed, 0 failed** in
  `axis_test_e2e_40650017d9b0`. Includes approval inbox preview, approval persisted
  across reload, execution and audit history, plus existing dashboard, ownership,
  notification and reminder workflows. Initial runs exposed sidebar overlap and
  ambiguous status locators, then aggregate test-IP rate exhaustion. Corrected
  the layout/selectors and isolated each spec file in its own HTTP server without
  raising or bypassing production rate limits.

The already-running PostgreSQL cluster was reused; the test script did not
restart the shared cluster. Connection restart and existing API/worker process
crash scenarios ran. No M4-specific hard process-kill or backup/restore test is
claimed. Local internal effects are transactional; external uncertain effects
remain prohibited rather than represented as successfully reconciled.

## Operation and remaining gates

Stop API and worker before upgrading. `npm run dev` applies migration 009 and
starts the API/dashboard; use `npm run dev:worker` separately for reminders.
Open Approvals from the sidebar. No new environment variables or dependencies.
Existing database, Google/session and optional BYOK configuration remains valid.

No development data was migrated by these tests, no live messages/provider
requests were sent, and no deployment or infrastructure was provisioned.
High-risk taxonomy/freshness, verified reauthentication, external integration
permissions/reconciliation and optional approval notifications remain future
work. See `12-m4-approval-security-gate.md` for the precise API contract and scope.
