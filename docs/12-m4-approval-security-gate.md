# M4 — Approval and security gate

Status: limited M4 implementation, 2026-10-17. External/high-risk execution and fresh reauthentication remain disabled. See validation results below.

## Specification gap

The supplied M4 attachment ends in section 9.1 at the incomplete field
`- executed`. On 2026-10-17 the owner instructed implementation to proceed with the available requirements. The repository still leaves the high-risk taxonomy and fresh-authentication window open. This implementation denies all external and high-risk actions; it does not silently adopt a freshness window.

## Existing implementation audited

- `packages/domain/src/chat-actions.ts` validates model drafts for task/reminder
  creation. Confirmation checks ownership, payload integrity, expiry and timezone.
  Owner-first row locking serializes confirmations; the internal record creation
  and proposal completion share a transaction.
- Migration 007 stores immutable `ai_action_proposals` with a 24-hour expiry and
  pending/succeeded/rejected states. Expiry is currently projected on reads.
- `services/api/src/ai-routes.ts` exposes the existing confirmation endpoint.
  It must delegate to the shared gate when migrated, not remain a bypass.
- `services/api/src/auth.ts` provides Google identity, database sessions, CSRF and
  Origin checks. It does not establish a separately verified fresh-authentication
  timestamp or an action-bound reauthentication challenge. A session's expiry
  must not be treated as proof of recent authentication.
- Existing security and acceptance documents require immutable approval,
  execution-time checks, high-risk reauthentication and uncertainty handling.

## Proposed implementation sequence

1. Resolve the missing specification and high-risk policy. Keep unsupported
   external operations denied, regardless of approval.
2. Extend or migrate the existing proposal store with a backend-owned registry,
   policy version, canonical security-context hash, durable lifecycle and audit.
   Preserve existing chat history and completed proposal evidence.
3. Route existing task/reminder confirmations through the shared service. Keep
   direct authenticated internal CRUD and the explicitly consented reminder
   notification exception within their existing documented policies.
4. Add owner-scoped proposal detail/list, approve/reject/cancel and execution
   contracts with strict input validation, expiry and transactional concurrency
   controls. Explicitly distinguish failure from uncertain external outcomes.
5. Add an approval inbox and exact effect preview to the existing dashboard.
   Preserve the existing chat confirmation experience. Determine notification
   scope from the complete specification before adding channel sends.
6. Implement and test the agreed fresh-authentication contract. Preserve account
   identity across the challenge; never allow a different Google account to
   authorize the original user's action.
7. Run the complete regression and security checks and document actual results.

## Threat model and acceptance targets

The model, request body, imported text and incoming channel messages cannot grant
permissions. Approval binds one owner and action ID to an immutable validated
payload, destination, account and policy context. Execution rechecks current
authorization; a previously approved action is not permanent permission.

Required evidence includes direct API bypass denial, cross-user denial, expired
and altered proposal denial, replay/concurrent execution safety, cancellation
races, fresh-authentication enforcement, complete content-free audit, durable
restart recovery and no blind retries after uncertain outcomes. Verify migration
from a clean database and upgrade from schema 8, plus existing authentication,
BYOK, chat, reminders and notification regressions.

## Implementation and operations

Migration 009 extends the existing `ai_action_proposals` table, preserving old chat proposals and success evidence. New proposals can exist without a chat conversation. Owner-scoped idempotency keys, immutable policy version and a SHA-256 security-context digest bind the owner, action ID, exact payload, derived action type, permission, application, risk and approval requirement. No integration account or external destination is accepted. The existing payload hash remains compatible with chat cards.

The backend registry allows only `task.create` and `reminder.create`, both category B internal operations requiring explicit approval. Owners may act only within their own workspace. Unknown operations, external applications, account/permission injection and obsolete policies are denied. Direct authenticated internal CRUD and consented scheduled notifications retain their previously documented policies. No generic tool dispatcher is added.

`operateApproval` is the common execution gate used by both chat confirmation and the approval API. Chat confirmation approves and executes atomically. The inbox separates those steps. The gate checks session-derived ownership, immutable hashes, current registry policy, status, expiry, timezone and validated draft. It serializes using owner-first row locks and repeats the expiry check at the execution claim. Local effects, completion evidence and audit commit in one PostgreSQL transaction. A crash rolls back incomplete local work; replay of a completed action returns its existing result. No network operation occurs in this transaction.

States: pending → approved → executing → executed, or rejected/cancelled/expired/failed. The database retains the legacy `succeeded` spelling for executed so chat history remains compatible. A local handler failure rolls back its savepoint, persists a sanitized failed outcome and prevents retry of that proposal. `unknown` is represented and blocked from execution, but no external handler or reconciliation adapter is registered. Never reuse this transactional design for network effects without a separate durable dispatch/reconciliation design. Expiry is enforced on every decision; inbox reads materialize and audit expired rows in batches of 100. There is no approval polling worker.

### API

All routes use existing Google sessions, CSRF, Origin checks, request limits and owner isolation. Base path: `/api/v1`.

- `POST /approvals`: strict `{ idempotency_key, action_type, payload }`. Payload follows the existing task/reminder chat draft schema. Timezone comes from the authenticated profile, never the client. Returns a pending proposal; no execution. Same owner/key/draft returns the original proposal. Changed draft conflicts.
- `GET /approvals?offset=0`: 30 newest proposals, plus `hasMore`.
- `GET /approvals/:id`: exact proposal and lifecycle status.
- `GET /approvals/:id/events`: content-free owner-scoped audit history.
- `POST /approvals/:id/approve`, `/execute`, `/reject`, `/cancel`: strict `{ payload_hash }`; no client authorization flags accepted. Approval never extends the original 24-hour deadline.
- Existing `/ai/actions/:id/decide` delegates to the same gate.

The inbox shows exact title/body, local and UTC schedule, recurrence, action ID, policy, expiry, status and audit. Cancellation prevents future execution when it wins the owner lock; executed actions cannot be recalled. No model availability is needed to review or execute a stored proposal.

### Run locally

Stop the API and worker before applying the upgrade. Run `npm run dev` to apply migration 009, build the UI and start the API on http://localhost:3000. In another terminal run `npm run dev:worker` for existing scheduled reminders. Open Approvals in the sidebar; new chat drafts also appear there. No new environment variables or dependencies are required. Existing `DATABASE_URL`, Google authentication/session settings and `APP_ORIGIN` remain necessary; encrypted BYOK settings are needed only for generating drafts through chat. See `setup_guide.md` for existing variable names and setup. Never paste secrets into chat.

### Limitations

This is not full M4 acceptance: fresh web reauthentication, connected-account scope revocation, external execution/reconciliation and approval delivery through Telegram/email are not implemented. External/high-risk operations fail closed, even with approval. Approval notices are dashboard-only; existing reminder consent is not expanded to approval messages. No financial execution, agent loop, live messages or deployment was performed. Production database-role hardening and backup/restore remain separate release gates.

### Validation results

`npm run check` passed formatting, lint, TypeScript and 34 unit/security tests.
The integration suite passed 77 tests and the browser suite passed all 6 tests.
`npm run build` passed. See [the verification report](m4-results.md) for exact
commands, isolated databases, initial failures and corrections, changed files
and remaining acceptance gates.
