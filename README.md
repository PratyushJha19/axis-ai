# AXIS — Documentation Pack

**Telegram commands:** [Setup and usage](docs/telegram-commands.md) covers the
optional linked-account command worker, webhook setup, task/reminder previews and
confirmation. Permanent deletion stays in the dashboard. See the verification
report before deployment.

**Version:** 1.0  
**Status:** M6 Calendar and recovery tooling are implemented locally; verification is recorded in `docs/m6-results.md`. Notifications default to simulation. Live provider acceptance, backup deployment and full release gates remain open.
**Purpose:** Give a coding agent a single, coherent source of truth for building AXIS in controlled, testable milestones.

## Start here

**Free hosted demo:** Vercel frontend + Render API preparation is in
[the deployment guide](docs/render-vercel-demo.md). This optional demo disables
background execution by default. For the owner's optional Telegram setup, follow
[free-host Telegram](docs/free-host-telegram.md): notifications run only while
Render is awake and may arrive late. No cloud service is deployed by these scripts
until the operator commits/configures and redeploys them.

**M6 implementation:** Separate read-only Google Calendar consent and cached busy
periods extend Planning. Migration 012 adds Calendar records and recovery quarantine.
Operator commands create encrypted PostgreSQL backups and verify isolated restores.
See [M6 setup and scope](docs/15-m6-calendar-backups-recovery.md) and the
[recovery runbook](docs/runbooks/disaster-recovery.md). Live Google verification,
off-machine storage, installed schedules/alerts and production RPO/RTO remain pending.

**M5 planning (2026-10-19):** The Planning page adds daily briefings, explainable
priorities, daily/weekly drafts, explicit acceptance, history and reminder-aware
rescheduling. Stop old processes, then `npm run dev` applies migration 011.
Run `npm run dev:worker` for opted-in proactive alerts; `npm run dev:agent` remains
separate for agent runs. Configure availability before time blocking. Alerts and AI
refresh require explicit opt-in. See [M5 operation](docs/14-m5-daily-intelligence-planning.md)
and [verification](docs/m5-results.md). M6 now extends this planner with Calendar.

**Agent runtime (2026-10-18):** Chat includes **Delegate a task** for internal reads
and M4-gated task/reminder creation. Stop existing processes, then run `npm run dev`
(migration 010), `npm run dev:worker` in a second terminal and `npm run dev:agent`
in a third. Each user supplies their own key in AI Settings. See
[M4.5 operation](docs/13-m4-5-agent-runtime-tool-execution.md) and
[verification](docs/m4-5-results.md). External connectors remain unavailable;
live model interpretation is unverified. M5 builds on this runtime.

**Approval gate (2026-10-17):** The new Approvals inbox shares the backend gate
with chat confirmations. Stop API/worker, then run `npm run dev` to apply migration
009 and restart the worker separately. Only internal task/reminder creation is
enabled; external/high-risk execution remains disabled. See
[M4 scope, API, limitations and verification](docs/12-m4-approval-security-gate.md).

**Reminder archive:** Finished and cancelled reminders now leave Active and remain
in Archive for seven days before worker cleanup. Stop API/worker and restart via
`npm run dev` to apply migration 008, then restart the worker. See
[archive and retention](docs/reminder-archive.md).

**Chat creation:** Ask AXIS to create a task or remind you at a given time, then
review and confirm the card to save it. See [chat actions](docs/chat-actions.md).
Stop API/worker before upgrading; the next `npm run dev` applies migration 007.

For complete first-time installation and everyday startup instructions, read
[the full setup and run guide](setup_guide.md), including Google, Groq, Telegram,
optional email, separate frontend development and troubleshooting.

**Telegram update (2026-10-15):** New live reminders use Telegram instead of
Twilio/WhatsApp. Follow [Telegram setup](docs/telegram-setup.md). No tunnel or
public URL is required for Telegram-only use. Migration 006 preserves history
and requires new Telegram linking/consent; email fallback is optional and off.
See [verification results](docs/telegram-results.md). Default mode remains mock.

For this Windows workspace, run `npm run setup:google` after creating your Google
OAuth client, then `npm run dev`. Open **http://localhost:3000**. See
[Google sign-in setup](docs/google-sign-in.md). Without credentials, the app shows
setup guidance and denies private access. For M2 reminders, run `npm run dev:worker`
in a second terminal. Delivery is simulated; no real messages or external actions occur.
See [M2 startup, configuration and API](docs/m2-operations.md).

M3 adds **Notifications** for verified personal channels and delivery history. See
[M3 setup and delivery policy](docs/11-m3-messaging-notifications.md) before changing
`NOTIFICATION_MODE` from `mock`. Run `npm run dev:worker` independently of the API.
No real messages are sent by default. Migration 005 requires an existing user to
sign in again before enabling email notifications. Stop after M3 for review; M4
approval execution is not implemented by this change.

Any verified Google account can now sign in and create a separate private workspace. Existing records stay with their original account. `OWNER_EMAIL` is no longer required or used. Google OAuth audience restrictions still apply. Each user enters their own Groq key in AI Settings. Use separate browser profiles/private windows to test two users; no deployment is included.

For AI, run `npm run setup:ai` to generate the server encryption secret without printing it, then restart with `npm run dev`. Open **AI Settings**, enter your personal Groq key there, test and save it, then open **Chat**. Provider usage may incur charges. No shared developer key is used. See [M1.5 setup, API, key rotation and acceptance](docs/10-m1-5-ai-provider-foundation.md). NVIDIA is not yet implemented. AI configuration is optional for tasks and reminders.

For local development see [the runbook](docs/runbook.md), [M0 scope and open decisions](docs/m0-plan.md), and [M0 verification results](docs/m0-results.md).

1. Read `AGENTS.md` at the repository root.
2. Read `docs/00-master-context.md`.
3. Read `docs/01-product-requirements.md` and `docs/02-technical-architecture.md`.
4. Read the remaining specifications before implementing the corresponding milestone.
5. Continue one verified milestone at a time. M6 is the current slice; stop for review before M7. Do not build the whole product in one pass.

## Document index

| File                                       | Purpose                                                     |
| ------------------------------------------ | ----------------------------------------------------------- |
| `AGENTS.md`                                | Mandatory operating rules for the coding agent              |
| `docs/00-master-context.md`                | Canonical product context, goals, principles, and decisions |
| `docs/01-product-requirements.md`          | User stories, scope, requirements, acceptance criteria      |
| `docs/02-technical-architecture.md`        | Architecture, stack, boundaries, deployment assumptions     |
| `docs/03-database-and-memory.md`           | Data model, memory semantics, migrations, retention         |
| `docs/04-security-and-approvals.md`        | Authorization, approvals, secrets, audit, privacy           |
| `docs/05-reminders-and-reliability.md`     | Scheduler, delivery state machine, retries, fallback        |
| `docs/06-api-and-integrations.md`          | API conventions, contracts, integration behavior            |
| `docs/07-ui-ux-specification.md`           | Screens, interaction rules, responsive behavior             |
| `docs/08-implementation-roadmap.md`        | Milestones and dependency order                             |
| `docs/09-test-plan-and-acceptance.md`      | Test strategy and release gates                             |
| `docs/decisions/architecture-decisions.md` | Decisions made and decisions intentionally left open        |

## Important status labels

- **DECIDED:** A requirement that should be implemented as written.
- **PROPOSED DEFAULT:** A pragmatic initial implementation choice. Keep it configurable where practical and record a decision if changing it.
- **OPEN DECISION:** Do not silently invent a product policy. Implement an interface/configuration seam or ask the owner before locking it.

## Core release principle

AXIS is not allowed to claim that a reminder, integration, backup, or external action is reliable merely because code exists. Reliability must be demonstrated with automated tests and, where relevant, a documented end-to-end or recovery test.

The MVP must not be considered releasable if a critical reminder can be lost without detection, an approval can be bypassed, duplicate consequential actions can occur, or a restore test fails.
