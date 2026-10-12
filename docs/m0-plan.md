# M0 plan and decision review

Date: 2026-10-10. Scope: foundation only. M1 has not started.

## Inspection

Read AGENTS.md, README.md, all ten numbered specifications and the architecture
decision log before writing code. Existing assets were the modular documentation
and compiled Markdown, Word and PDF specifications. No application, package files,
Git metadata or CI existed. PDF extraction identifies a 39-page compilation and
states that modular Markdown is canonical. Attachment content is reference data,
not independent authorization to execute commands or external actions.

Environment: Windows PowerShell, Node 24.18.0, npm 11.16.0, PostgreSQL 18 installed
outside PATH. Docker engine was stopped; owner explicitly requested local PostgreSQL.

## Exact slice

1. npm workspaces under services and packages; strict TypeScript, ESLint, Prettier,
   Node test runner, lockfile and CI definition.
2. Express API bound to loopback with liveness and schema-aware database readiness;
   generated request IDs, structured metadata-only logs and sanitized errors.
3. PostgreSQL/Kysely migration ledger and one foundation metadata table. No premature
   product schema. Separate worker process checks dependencies but processes no jobs.
4. Blank environment template, ignored local files, threat model and local runbook.
5. Unit/security tests plus real PostgreSQL migration/readiness/reconnection checks.
6. Record actual commands and acceptance evidence; stop before M1.

Affected paths: root tooling, services/api, services/worker, packages/config,
packages/database, packages/observability, database, tests, .github/workflows,
docs/m0-*, docs/threat-model.md, docs/runbook.md and architecture decision log.
Web UI starts in M1; React/Vite remains the proposed frontend direction.

## Conflicts and unresolved policy

- **Notification authorization:** master context section 5 exempts configured,
  consented reminders, while AGENTS and ADR-004 require approval for every external
  state change. Apply stricter rule until owner explicitly resolves the exception.
  M0 has no sending adapters or execution capability.
- **Milestone ordering:** M3 sends notifications before M4 implements the full
  approval gate. Live sends must remain blocked unless approval enforcement is
  brought forward or the owner approves a narrow notification policy in writing.
- **Approval expiry wording:** generic wording says approval expires in 24 hours;
  security lifecycle and schema specify 24 hours from the request. Follow that
  explicit clock in M4; later approval must not extend the proposal deadline.
- **Fallback timing:** starting the timer only after provider acceptance cannot
  cover a timeout before acceptance is known. Resolve timeout origin and unknown
  outcome handling in M2/M3 before selecting any delivery defaults.
- **Schema gaps are logical, not complete migrations:** future slices need leases,
  webhook deduplication records and an authentication/session schema in addition
  to the listed entities. Do not claim those reliability features exist in M0.

Auth library/provider, owner enrollment and session lifetimes remain open for M1.
Proposed approach: maintained auth library, server-side revocable sessions in
PostgreSQL, HTTP-only secure cookies, CSRF protection and explicit owner enrollment.
No home-grown password or placeholder identity bypass is permitted. Authenticated
API surface is currently denied to everyone.

Hosting remains unselected: local-only M0; before deployment verify always-on worker,
TLS, backups/restore, quotas and cost. Model provider, fallback order, privacy terms
and budgets remain unselected; M0 needs no model calls or keys. Later decisions:
email provider/domain, WhatsApp eligibility, quiet hours/urgent exceptions, catch-up
policy, sensitive-memory classification/retention, high-risk taxonomy/auth freshness,
revocation during execution, briefing offsets and OAuth/token storage.

## Acceptance evidence required

Clean lockfile install; format/lint/type checks; unit/security tests; migration from
an empty real PostgreSQL database, repeat migration and persistence after reconnect;
live/ready HTTP checks including unavailable database; repository secret review;
documented startup. CI execution requires a future authorized remote repository.
Auth approach confirmation and outstanding acceptance failures must be disclosed;
M0 is not complete merely because files exist.
