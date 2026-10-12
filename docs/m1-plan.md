# M1 — Identity, projects, memory and tasks

Date: 2026-10-10. Owner requested the MVP and selected Google sign-in. Work proceeds
one milestone at a time under AGENTS.md; M2–M6 remain required for the full MVP.

## Slice and affected modules

- Google OpenID Connect using openid-client; allow-listed verified email, immutable
  owner subject, PostgreSQL sessions, logout, expiry, CSRF and request throttling.
- Migration 002: users, singleton owner binding, sessions, consumed OAuth challenges,
  projects, tasks, memory, task history, append-only audit and idempotency keys.
- Strict validated owner-scoped APIs, pagination, optimistic update/delete versions,
  idempotent creates, PostgreSQL memory full-text search and hard deletion.
- React/Vite local dashboard: overview, tasks, projects, memory and settings;
  responsive sidebar, real totals, record forms, consent, history and status states.
- Tests for authentication failure, ownership, duplicate/concurrent creation,
  consent, credential-shaped content, correction, archive, deletion, schema and UI.

Paths: apps/web, services/api, packages/shared, packages/domain, migration registry
and database readiness, tests/unit/integration/e2e, root build configuration,
scripts/verify-local.ps1, docs and architecture decision log.

## Acceptance

Records and sessions persist outside process memory; unauthorized and cross-owner
requests fail; sensitive memory requires consent; source and truth labels remain
visible; schema migration from empty DB and M0 succeeds; API contract and browser
flows pass. Real Google OAuth remains a manual acceptance gate requiring owner setup.

No fake identity provider is wired into production. The browser test harness creates
its own local app and fake provider, requires an isolated axis_test_e2e_ database,
and is not shipped in the frontend bundle. It never contacts Google.

## Deliberate limits and open decisions

No reminders, messaging, calendar access, model calls, briefing generation or external
execution is added. Recurrence/dependencies and planning remain later slices; current
task capture is structured, with no natural-language interpretation claim. Memory
privacy classification is explicit user input plus conservative keyword guards, not
a complete sensitive-data classifier. Credential blocking is heuristic, not a vault.

Notification authorization versus consented reminders, high-risk taxonomy and fresh
authentication, fallback timing, quiet hours, catch-up behavior and providers remain
open before their respective milestones. No policy exception was inferred from the
request to build the MVP. Local PostgreSQL remains selected; hosting is unselected.

Project pickers show at most 100 projects in this initial slice. List pages contain
30 records, with previous/next pagination. Task view filters are explicitly labelled
as applying to the current page. Production hosting, reliable recovery, broader
accessibility audit and real-provider testing remain release gates.
