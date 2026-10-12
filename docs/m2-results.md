# M2 — Durable reminder engine results

Date: 2026-10-12. Status: M2 implemented and verified for local **mock-only**
delivery. Stop here for owner review before M3. Full MVP/provider-delivery and
backup/restore release gates remain open.

## Scope delivered

Owner-scoped reminder creation/inspection/editing/rescheduling/cancellation/snooze;
daily/weekly recurrence; explicit local-time preview and confirmation; UTC persistence
with IANA timezone; quiet/focus deferral; durable attempt history; separate worker;
atomic leased claims, fenced completion, stable occurrence idempotency, bounded
backoff/retries and unknown-outcome reconciliation. Dashboard adds a Reminders view
with delivery details, attention reasons, skipped counts, preferences and worker
status while retaining M1 tasks/projects/memory and Google authentication.

Mock receipts are persisted in PostgreSQL. No network notification adapter exists.
`delivered (simulated)` means a mock receipt was recorded, not that a person received
a notification. There is no M3 fallback, M4 approval executor or model integration.
The owner approved the M2 policy choices; durable record: ADR-015.

## Files changed

| Area             | Files                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration        | `database/migrations/003-reminders.ts`, `database/scripts/migrator.ts`, `packages/database/src/index.ts`                                                                                      |
| Contracts/domain | `packages/shared/src/reminders.ts`, `packages/domain/src/reminder-time.ts`, `packages/domain/src/reminders.ts`                                                                                |
| API              | `services/api/src/reminder-routes.ts`, `services/api/src/routes.ts`                                                                                                                           |
| Worker           | `services/worker/src/engine.ts`, `provider.ts`, `main.ts`, `health.ts`                                                                                                                        |
| Dashboard        | `apps/web/src/Reminders.tsx`, `App.tsx`, `styles.css`; regenerated ignored `apps/web/dist`                                                                                                    |
| Tests            | `tests/unit/reminder-time.test.ts`, `tests/integration/reminder-scenarios.ts`, `worker-crash-fixture.ts`, `database.test.ts`, `core-scenarios.ts`, `tests/e2e/reminders.spec.ts`, `server.ts` |
| Tooling/config   | `package.json`, `package-lock.json`, `.env.example`, `.gitignore`, `scripts/start-local.ps1`, `scripts/check-persistence.ts`                                                                  |
| Documentation    | `README.md`, `docs/m2-plan.md`, `m2-operations.md`, `m2-results.md`, `runbook.md`, `threat-model.md`, `decisions/architecture-decisions.md`                                                   |

Migration 003 adds `reminders`, `notification_attempts`, `reminder_preferences`,
`mock_notification_receipts`, and `worker_heartbeats`; advances schema readiness to
version 3; and adds indexes, ownership foreign keys, state/range constraints and
occurrence-attempt uniqueness. It does not replace M1 tables or records. Additive
upgrade was tested with an existing synthetic M1 task, which remained intact.

Temporal polyfill and its transitive dependency were added for calendar/DST arithmetic.
Downloaded Google client JSON files are now ignored by the credential filename pattern;
no such file was read, modified, uploaded or committed during M2. Local configuration
was not changed. No Git metadata or remote exists in this workspace, so no commit or
remote CI run is claimed.

## Commands and actual outcomes

| Command/check                                                                           | Result                                                                                                                                  |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `npm install @js-temporal/polyfill`                                                     | Passed after sandbox DNS restriction; two packages added, lockfile updated                                                              |
| Targeted `npx prettier --write ...` and `npm run format:check`                          | Passed                                                                                                                                  |
| `npm run check`                                                                         | Formatting, lint, both TypeScript projects, and 12 unit/security tests passed                                                           |
| `./scripts/verify-local.ps1`                                                            | 21 tests passed (20 named recovery scenarios plus parent migration/M1/API scenario), isolated database `axis_test_698fb79be7ed`         |
| `npm run build`                                                                         | Passed; approximately 269 kB JS, 83 kB gzip                                                                                             |
| `./scripts/verify-local.ps1 -Browser`                                                   | 3 Edge browser tests passed, including the unchanged M1 workflow and independent-worker delivery, database `axis_test_e2e_6d8688224bb3` |
| `node --import tsx scripts/check-persistence.ts` against retained test DB after restart | M1 task, M2 delivered reminders, attempt history and mock receipts survived real PostgreSQL stop/start                                  |
| `node --import tsx scripts/smoke.ts` against retained test DB                           | API startup/live/ready and separate worker database readiness passed                                                                    |
| `npm audit --audit-level=high`                                                          | Zero reported vulnerabilities                                                                                                           |
| Configured-secret comparison scan                                                       | 85 source/documentation/build files checked, zero configured secret matches; values never printed                                       |
| Visual review                                                                           | Desktop 1440px and mobile 390px reminder screenshots inspected; browser test confirmed no horizontal overflow                           |

The configured-secret scan compares known local configuration values; it is not a
claim to detect every unknown credential. Screenshots contain synthetic test records
and remain in ignored `.local/m2-reminders-desktop.png` and mobile equivalent.

During implementation, type checking caught a UUID-inferred variable that needed an
explicit string type. Formatting caught two files requiring another pass. The first
M2 browser run failed on a dropdown test selector; using its accessible combobox role
fixed the test. Review exposed a repeated-DST-hour quiet-end issue; instant-based
boundaries fixed it and regression tests passed. These failures are not counted as
successful runs. The final tests exercised the corrected behavior.

## Acceptance evidence

- Clean database migrates through 001/002/003, M1 data survives the additive upgrade,
  and repeating migration is a no-op. Schema readiness is tested before/after migration.
- Reminders persist through database reconnection, two actual API process starts/stops,
  actual worker restart and PostgreSQL restart. The worker imports no model/API code;
  process tests use an unreachable synthetic model endpoint and no web/model server.
- Eight concurrent workers produce one attempt and one durable receipt. Expired leases
  are reclaimed; stale prepare/completion tokens are rejected.
- Hard-exit subprocesses stop after claim, dispatch marker, provider receipt and result
  persistence. Recovery produces one receipt for each logical occurrence.
- A provider receipt followed by a real response timeout becomes unknown; reconciliation
  confirms the receipt without another send. Provider exceptions fail closed.
  Sent/unconfirmed status is distinct from delivery. Unresolved outcomes stop after
  bounded reconciliation and remain visible; owner-requested reconciliation never
  blindly authorizes sending.
- Cancellation committed after claim but before dispatch prevents the attempt. Dispatch
  committed first makes cancel/edit/snooze conflict, rather than falsely promise recall.
- Snooze prevents early send. Quiet hours/focus chains defer without losing the record;
  preferences saved after claim are rechecked. Overlapping focus blocks are rejected.
- Kolkata conversion, spring/fall DST, ambiguous/nonexistent times, daily/weekly wall
  recurrence, skipped overdue repeats, duplicate completion and recurrence-review
  state are covered with fake clocks.
- Transient/rate-limit failures respect retry-after/backoff and stop at attempt limit;
  permanent/configuration failures need attention immediately. Fresh/stale worker
  health CLI exit codes are tested.
- Reminder APIs reject unauthenticated access, missing CSRF, injected owner IDs, missing
  confirmation, cross-owner reads/attempts/cancellation/links and invalid pagination.
  Idempotency replay, payload conflicts, version conflicts and profile timezone are
  checked. Existing M1 auth, privacy, CRUD, session and audit tests still pass.
- Browser tests cover confirmation preview, UTC interpretation, save/edit (including
  clearing body), snooze, cancellation, preferences, persistence on reload, mobile
  layout and a mock receipt produced by the independent worker.

## Run and configuration

See [M2 operations and API](m2-operations.md) for commands, full configuration names,
defaults, API contracts and recovery guidance. Start API/dashboard with `npm run dev`
and worker with `npm run dev:worker` in another terminal. `npm run worker:health`
checks readiness independently. Both use the same private DATABASE_URL.

No new required secrets. Google sign-in retains the existing API settings; the worker
does not need them. Optional `REMINDER_*` limits are listed in `.env.example` and the
operations guide. The launcher leaves PostgreSQL running when the API exits so web
shutdown does not stop reminders. Stop PostgreSQL explicitly after both processes.

## Limits and remaining decisions

- Reliability evidence applies to the tested local mocked adapter. M3 still needs real
  provider contracts, recipient verification, notification approval/consent resolution,
  callback authentication/deduplication, email fallback policy and sandbox acceptance.
- Recurrence is once/daily/weekly only; no arbitrary RRULE, recurring-task rewrite,
  automatic deadline offset generation or task/reminder synchronization. Users can
  set explicit before/on/after-deadline timestamps and link a task/project.
- Quiet/focus suppression has no urgent bypass, per owner choice. Already deferred
  attempts keep their saved next time when preferences change. Profile timezone changes
  do not reinterpret existing recurrence. Ambiguous future times in reject mode pause
  for owner review rather than guessing.
- In-flight/unknown reminders cannot be edited or cancelled until resolved. Reconciliation
  exhaustion stays visible; restarting the worker does not silently resend it.
- Status updates use manual Refresh reminders. Link pickers show the first 100 records;
  focus-block preferences hold at most 100 explicitly managed blocks. No retention job
  prunes attempt history or mock receipts in M2.
- Local processes are manually started. No deployment, supervisor, paid infrastructure,
  live messages, calendar writes or AI calls occurred. Real Google acceptance was not
  rerun; tests use the existing controlled identity provider.
- Backup restore, production least-privilege roles, provider reliability, load/soak
  testing and availability targets are not established here. A PostgreSQL restart
  persistence check is not a backup restore test. Those remain later release gates.

Test databases were retained. Test API/worker/browser processes were stopped. The
development database has not been migrated or populated with synthetic M2 reminders;
the owner's next `npm run dev` applies migration 003 normally. Do not proceed to M3
without owner review.
