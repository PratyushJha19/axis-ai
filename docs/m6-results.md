# M6 verification and remaining acceptance gates

Date: 2026-10-20. M6 implementation is ready for local review. Live Calendar
acceptance and deployed backup operations remain unverified. Stop before M7.

## Delivered scope

- Separately consented, owner-scoped, read-only primary Google Calendar integration.
  OAuth state is single-use and session-bound, with PKCE, nonce, scope and account
  checks. Refresh credentials are encrypted; disconnect invalidates pending flows.
- Bounded event refresh and cached commitments in the existing Planning page.
  Daily/weekly planning respects busy intervals, all-day events and timezones.
  Missing or stale Calendar coverage is disclosed; tasks/reminders remain available.
- Consistent PostgreSQL dumps encrypted while streaming, authenticated manifests,
  checksums, private storage checks, verified retention and backup health commands.
- Actual isolated restore verification of schema, records and encrypted credentials.
  Explicit recovery creates a new quarantined database and clears restored sessions.
  Post-snapshot task/reminder uncertainty is held for review, not automatically replayed.
- Operator recovery runbook and Windows schedule templates. No schedule was installed.

## Changed files

| Area            | Files                                                                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration       | `database/migrations/012-calendar.ts`, `database/scripts/migrator.ts`, `packages/database/src/index.ts`                                                                                                                                                                                        |
| Calendar        | `packages/shared/src/calendar.ts`, `packages/domain/src/calendar.ts`, `packages/domain/src/calendar-provider.ts`, `services/api/src/calendar-routes.ts`                                                                                                                                        |
| API and workers | `services/api/src/app.ts`, `services/api/src/main.ts`, `services/worker/src/agent-main.ts`                                                                                                                                                                                                     |
| Planning        | `packages/domain/src/planning.ts`, `packages/domain/src/planning-engine.ts`, `packages/domain/src/agent-tools.ts`                                                                                                                                                                              |
| Dashboard       | `apps/web/src/Calendar.tsx`, `apps/web/src/Planning.tsx`, `apps/web/src/App.tsx`                                                                                                                                                                                                               |
| Recovery        | `scripts/backup-lib.ts`, `scripts/backup.ts`, `scripts/recovery-quarantine.ts`, `scripts/backup-scheduled.ps1`, `scripts/install-backup-schedule.ps1`, `scripts/rotate-ai-keys.ts`                                                                                                             |
| Configuration   | `package.json`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`                                                                                                                                                                                                                       |
| Tests           | `tests/unit/calendar.test.ts`, `tests/unit/backup.test.ts`, `tests/integration/calendar-scenarios.ts`, `tests/integration/backup-scenarios.ts`, `tests/integration/database.test.ts`, `tests/integration/multi-user-scenarios.ts`, `tests/e2e/calendar.spec.ts`, `tests/e2e/server.ts`         |
| Documentation   | `README.md`, `SETUP_GUIDE.md`, `docs/00-master-context.md`, `docs/08-implementation-roadmap.md`, `docs/15-m6-calendar-backups-recovery.md`, `docs/decisions/architecture-decisions.md` (ADR-026), `docs/runbook.md`, `docs/runbooks/disaster-recovery.md`, `docs/threat-model.md`, this report |

Migration 012 adds Calendar connections/challenges and recovery quarantine. Existing
records remain in place. No dependency was added.

## Verification

| Command                                          | Observed result                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `npm run check`                                  | Final rerun passed formatting, lint, types and all 45 unit/security tests; zero failed/skipped. |
| `./scripts/verify-local.ps1`                     | Final rerun: 108 tests passed, zero failed/skipped, against fresh `axis_test_d9179e357495`.     |
| `./scripts/verify-local.ps1 -Browser`            | Final unchanged rerun: all 9 browser tests passed against `axis_test_e2e_9c86bf069ae4`.         |
| `npm run build`                                  | Passed after the final Calendar return-flow UI change.                                          |
| `npm audit --audit-level=high`                   | Passed; zero reported vulnerabilities.                                                          |
| PowerShell parser validation of schedule scripts | Passed; installation/execution as SYSTEM not tested.                                            |

The integration suite includes fresh/repeated migrations, OAuth isolation and replay,
disconnect/refresh races, Calendar outage and planner fallback, existing M1–M5
regressions, reminder/agent process failures, actual PostgreSQL dump/restore,
corrupt artifacts, incorrect/missing keys, interrupted backup preservation and
post-snapshot uncertainty in a new quarantined recovery database. Providers are
mocked; backup tests use real PostgreSQL 18 tools and synthetic private records.

An earlier verification attempt encountered prolonged PostgreSQL crash recovery
and a startup-child test timeout. PostgreSQL finished recovery without reset or
data deletion. The unchanged startup test and full suites subsequently passed.
The final integration helper found PostgreSQL already running, so its optional
whole-cluster restart branch did not run in that invocation; process restart and
connection persistence scenarios did run.

A browser regression run passed eight tests but timed out waiting five seconds
for a simulated reminder receipt. The snapshot showed a healthy worker and one
due reminder. This is recorded as a timing failure, not evidence of successful
delivery; the unchanged suite was rerun to check reproducibility. All nine tests
passed on that rerun, including the worker delivery test in two seconds. The earlier
timeout remains a test-timing limitation; no assertion or timeout was relaxed.

## Local startup and configuration

Stop old application processes before upgrading. From the repository:

```powershell
npm run dev
```

This applies migrations, builds the dashboard and starts the API at
`http://localhost:3000`. In separate terminals:

```powershell
npm run dev:worker
npm run dev:agent
```

The reminder worker handles reminders/planning alerts; the agent worker handles
delegated runs. Calendar refresh needs neither model availability nor a new worker.

Calendar reuses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN`,
`SESSION_SECRET` and the existing `AI_CREDENTIALS_*` encryption keyring. Configure
the separate `/api/v1/calendar/callback` redirect and Calendar API read scope,
then connect explicitly from Planning. No user Groq key is required for Calendar.

Backups require existing `DATABASE_URL`, a private absolute `BACKUP_DIRECTORY`,
separate `BACKUP_ENCRYPTION_KEY`, `BACKUP_KEY_VERSION` (default `v1`) and optionally
`PG_BIN`. Keep application and backup recovery keys independently protected.
Use `npm run backup`, `npm run backup:verify`, `npm run backup:restore-check`
and `npm run backup:health` after following the storage/permissions runbook.
Secrets are not included in this report.

## Remaining limitations and operator decisions

- Live Google consent, refresh, revoked access and disconnect require a configured
  test account and manual acceptance. Only the primary calendar and explicit refresh
  are supported. Previously accepted plans are not automatically rewritten.
- No real messages, calendar writes, deployment or paid resources were used.
  Calendar text is not supplied to AI; Calendar write tools remain unavailable.
- Choose and verify protected off-machine storage, scheduler identity/access,
  monitoring and failure alert delivery. Templates alone do not provide automation.
- Remote CI, installed Windows tasks and remote alerts have not been exercised.
- The 24-hour RPO and four-hour RTO are targets, not achieved production guarantees.
  A small synthetic restore is not an end-to-end disaster recovery drill.
- Recovery cannot infer external effects or task changes after the backup snapshot.
  Keep restored systems quarantined until evidence is reconciled and release is
  explicitly reviewed. Never replay uncertain sends or approvals automatically.

See [setup](../SETUP_GUIDE.md), [M6 design](15-m6-calendar-backups-recovery.md)
and the [disaster recovery runbook](runbooks/disaster-recovery.md).
