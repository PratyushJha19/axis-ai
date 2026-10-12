# AXIS — Test Plan and Acceptance Criteria

**Version:** 1.0 | **Release gate:** tests must prove safety and reliability, not just happy paths

## 1. Test layers

- Unit tests: pure domain rules, state transitions, date/time, risk policy, recurrence.
- Integration tests: PostgreSQL transactions, worker claims, repository ownership scopes.
- API/contract tests: validation, auth, error contracts, idempotency, webhook signatures.
- Provider adapter tests: mocked provider success/failure/timeout and status mapping.
- End-to-end tests: capture → persistence → reminder → status; proposal → approval → action result.
- Security tests: authorization bypass, prompt injection, secret leakage, replay/concurrency.
- Recovery tests: backup restore and post-restore reconciliation.
- Manual sandbox tests: WhatsApp Sandbox and email provider setup.

## 2. Release-blocking scenarios

### Reminder durability
1. Create reminder, restart API and worker, verify reminder remains due and is processed.
2. Disable model provider at due time; reminder still processes.
3. Crash worker before provider call; lease expires and work is reclaimed.
4. Simulate provider timeout after request may have reached provider; status becomes unknown and reconciliation runs before retry.
5. Send duplicate/out-of-order status callbacks; one logical state transition and no duplicate fallback.
6. WhatsApp explicit failure triggers configured fallback/retry.
7. WhatsApp delivery unconfirmed past configured timeout triggers email fallback.
8. Email unavailable or unverified: fallback blocked status and owner alert appear.
9. Cancel reminder while queued; it is not sent after cancellation wins the race.
10. Two workers claim same reminder concurrently; only one logical send occurs.
11. Restore database with overdue reminders; reconciliation does not flood or duplicate notifications.
12. Test quiet hours, focus block, timezone conversion, DST where relevant, and recurrence.

### Approval gate
1. Direct API execution without approval returns `APPROVAL_REQUIRED`.
2. Expired approval returns `APPROVAL_EXPIRED`.
3. Modified payload hash returns `PAYLOAD_MISMATCH`.
4. Wrong user/owner cannot approve or execute.
5. Replayed approval webhook does not execute twice.
6. Two concurrent execute requests result in at most one effect.
7. High-risk action without fresh web authentication fails.
8. An approved action with changed destination requires new approval.
9. Unknown execution outcome is reconciled before retry.
10. Audit trail records request, approval/rejection/expiry, execution attempt, and outcome.

### Memory and privacy
1. Routine fact can be saved under default policy.
2. Sensitive fact is not saved until consent.
3. Confirmed/assumed/suggested labels persist.
4. Correction updates current retrieval.
5. Deleted memory is excluded from normal search.
6. Archived project memory remains searchable when requested/relevant.
7. Secrets cannot be stored as ordinary memory.
8. Cross-user access is denied by service and repository tests.

### Backup and recovery
1. Daily backup job creates a restorable backup.
2. Retention removes backups older than seven daily copies according to policy.
3. Restore into isolated environment succeeds.
4. RPO/RTO measurement is documented.
5. After restore, reminders, attempts, approvals, and uncertain actions reconcile safely.
6. Secrets are handled separately from ordinary database backups.

## 3. Acceptance by milestone

### M0
- Clean install; formatting/lint/typecheck/test commands; migration from empty DB; health checks; no secrets.

### M1
- Authenticated CRUD, ownership checks, memory consent, searchable memory, persistent tasks, audit/history where required.

### M2
- Independent worker, durable reminder state, retry/backoff, idempotency, cancellation, unknown-outcome reconciliation.

### M3
- Sandbox messaging, signature validation, normalized delivery state, email fallback, no duplicate sends in replay tests.

### M4
- Server-side approval gate, 24-hour expiry, immutable payload, high-risk re-auth, complete audit lifecycle.

### M5
- Dashboard displays persisted truth, daily briefing and plan proposals are accurate and non-overlapping, reschedule proposals require confirmation.

### M6
- Read-only calendar, backups, successful restore test, documented operations runbook.

## 4. Reliability targets

These are targets to measure, not claims to make before measurement:
- No known silent loss of critical reminders.
- Zero approval-gate bypasses in the release test suite.
- Zero duplicate consequential effects in replay/concurrency tests.
- Successful monthly restore test.
- RPO target ≤24 hours and RTO target ≤4 hours, validated against hosting.
- Every reminder has an observable final or unresolved state; unresolved items are surfaced.

Do not promise 100% delivery because external providers, connectivity, quotas, and account eligibility are outside AXIS's control.

## 5. Test data and privacy

- Use synthetic data in automated tests.
- Never use real personal memory or secrets in fixtures.
- Redact message bodies and provider responses in snapshots.
- Keep sandbox and production credentials separate.
- Use deterministic fake clocks for expiry and scheduling tests.
- Do not send test messages to real third parties.
