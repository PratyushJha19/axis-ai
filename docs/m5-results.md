# M5 implementation and verification — 2026-10-19

Scope: deterministic daily intelligence, explainable task ranking, optional BYOK
recommendations, daily/weekly plans, explicit reminder-aware recovery and opt-in
proactive alerts. Existing authentication, dashboard, task/project/memory services,
M4 approval gate, M4.5 runtime and M2/M3 notification infrastructure are reused.

## Files and migrations

New files:

- `database/migrations/011-planning.ts`: planning preferences, plans, generation
  receipts, feedback and durable alert identities. Schema readiness becomes 11.
- `packages/shared/src/planning.ts`: strict contracts and view types.
- `packages/domain/src/planning-engine.ts`: deterministic rank/timezone/schedule
  logic and backend conflict validation.
- `packages/domain/src/planning.ts`: owner-scoped briefing, plan, preference,
  feedback, AI advice and recovery services.
- `packages/domain/src/planning-alert-policy.ts`: source/consent dispatch checks.
- `services/api/src/planning-routes.ts`: authenticated intelligence/planning APIs.
- `services/worker/src/planning-alerts.ts`: bounded event evaluation using existing
  reminder records and worker, with atomic event deduplication.
- `apps/web/src/Planning.tsx`: briefing, availability, planning and recovery UI.
- `tests/unit/planning.test.ts`, `tests/integration/planning-scenarios.ts`,
  `tests/e2e/planning.spec.ts`: new deterministic, database and browser coverage.
- `docs/14-m5-daily-intelligence-planning.md` and this report.

Updated files:

- `database/scripts/migrator.ts`, `packages/database/src/index.ts`: migration
  registration/readiness. Earlier applied migration files are unchanged.
- `packages/domain/src/reminders.ts`: allow existing cancellation to compose
  inside the atomic recovery/settings transaction.
- `packages/domain/src/agent-tools.ts`: read-only briefing/plan tools. M4 write
  policies are unchanged; the model cannot use planning APIs as an alternate executor.
- `services/api/src/app.ts`: mount protected planning APIs.
- `services/worker/src/main.ts`, `engine.ts`, `delivery.ts`: scheduled evaluation
  and fresh-dispatch source checks. Uncertain attempts retain reconciliation.
- `apps/web/src/App.tsx`, `styles.css`: Planning navigation, compact overview,
  lazy-loaded planning bundle and responsive form spacing.
- `tests/integration/database.test.ts`, `multi-user-scenarios.ts`: clean upgrade
  and authenticated cross-user/CSRF/authority coverage.
- `tests/e2e/dashboard.spec.ts`: qualify the existing task-card selector because
  the new briefing also shows the same title. The original assertion remains.
- README, setup guide, master context, API docs, roadmap and ADR-025.

No new dependency, environment variable, paid resource or deployment was added.
Existing unrelated M4/M4.5/UI working-tree changes were preserved.

## Actual checks

- `npm run check`: formatting, lint, backend/frontend TypeScript checks passed;
  **40 unit/security tests passed, 0 failed**.
- `npm run build`: passed. Main JavaScript approximately 407 kB and the separately
  loaded planning chunk 175 kB; no oversized-chunk warning after splitting.
- `npm audit --audit-level=high`: **0 vulnerabilities**.
- `./scripts/verify-local.ps1`: **98 integration tests passed, 0 failed** in the
  final isolated PostgreSQL run. Clean migrations, repeat-safe upgrades and the
  existing actual PostgreSQL restart persistence checks passed. Earlier M5 runs
  passed 96, then 97 tests before additional security/dispatch coverage.
- `./scripts/verify-local.ps1 -Browser`: **8 tests passed, 0 failed** in the final
  run, database `axis_test_e2e_109c63e45617` retained for inspection. Includes actual
  plan acceptance, reload, discard and linked-reminder cancellation during recovery.

An initial sandboxed security run had a loopback `EACCES`; the authorized rerun
passed. An earlier dashboard browser assertion matched two legitimate task titles
after adding the briefing. It was qualified to the original task card and passed;
the application feature/assertion was not removed.

Tests cover deterministic priority/urgency/ties, missing estimates, local dates,
configurable weeks and DST, capacity, hard deadlines, focus blocks, buffers,
invalid/foreign IDs, plan deduplication and reconnect persistence, explicit
accept/discard, optimistic version conflicts, stale task/focus changes, missed
blocks, validated AI recommendations, source-cache invalidation, provider unknown
fallback, durable AI replay and quotas, transactional task/reminder rescheduling,
refusal after unresolved dispatch, event opt-in/quiet hours/deduplication and
fresh dispatch suppression after source completion. Existing M0–M4.5 regressions
remain part of the database/browser suites. External providers are mocked.

## Local operation

Stop old AXIS processes before upgrading. In separate terminals from `G:\axis-ai`:

```powershell
npm run dev
```

```powershell
npm run dev:worker
```

```powershell
npm run dev:agent
```

The first command applies migration 011 and starts API/web. The reminder worker
also evaluates opt-in planning events. The agent process is needed only for agent
runs; briefing, deterministic planning and manual AI refresh do not require it.

Open http://localhost:3000 and **Planning**. Set the profile timezone, enter actual
availability, add task estimates, generate/review a daily or weekly draft and
explicitly accept it. Acceptance changes the plan only. Use the separate recovery
review to change due times and reconcile linked reminders.

Optional advice reuses each user's Groq key and existing server encryption config.
Optional alerts require saved planning opt-in plus existing channel consent and
configuration. No live messages were sent during this work. Full contracts/limits
are in `14-m5-daily-intelligence-planning.md` and instructions in `SETUP_GUIDE.md`.

## Limitations and remaining manual gates

- Calendar, project deadline/priority fields, dependency edges and recurring tasks
  are unavailable. They are disclosed rather than fabricated. Project context uses
  real linked task counts/statuses; memory does not silently set work availability.
- AI assists task choice and explanation. Time blocks are deterministic; model
  text cannot approve or perform a mutation. Live model quality/entitlements and
  live Telegram delivery were not tested or authorized in this milestone.
- Only selected or the first 100 ranked tasks enter a draft. Briefing source limits
  are 500 tasks/200 projects, and the UI discloses truncation. More sophisticated
  splitting/optimization and historical analytics remain future work.
- Accepted plans preserve versions and current progress; general past-state
  reconstruction and automatic plan/history retention are not implemented.
- Proactive kinds are daily briefing and important approaching/overdue task
  deadlines. Calendar/project-conflict notifications need their missing sources.
  There is no automatic background AI generation.
- Existing reminder rules govern in-flight or uncertain outcomes. Rescheduling
  cannot recall a message; conflicts reject the entire task/reminder change.
- Development data was not reset or migrated by the test runs. Apply the migration
  using normal local startup after review. Test databases are retained.
- M6 was not started. Review M5 before expanding scope.
