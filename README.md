# AXIS — Documentation Pack

**Version:** 1.0  
**Status:** Multi-user Google sign-in implemented; each account has private records and BYOK settings. Live two-account Google and Groq acceptance remain pending. See `docs/multi-user-results.md`, `docs/m1-5-results.md` and `docs/m2-results.md` for evidence and limitations. Full MVP release gates remain open.  
**Purpose:** Give a coding agent a single, coherent source of truth for building AXIS in controlled, testable milestones.

## Start here

For this Windows workspace, run `npm run setup:google` after creating your Google
OAuth client, then `npm run dev`. Open **http://localhost:3000**. See
[Google sign-in setup](docs/google-sign-in.md). Without credentials, the app shows
setup guidance and denies private access. For M2 reminders, run `npm run dev:worker`
in a second terminal. Delivery is simulated; no real messages or external actions occur.
See [M2 startup, configuration and API](docs/m2-operations.md).

Any verified Google account can now sign in and create a separate private workspace. Existing records stay with their original account. `OWNER_EMAIL` is no longer required or used. Google OAuth audience restrictions still apply. Each user enters their own Groq key in AI Settings. Use separate browser profiles/private windows to test two users; no deployment is included.

For AI, run `npm run setup:ai` to generate the server encryption secret without printing it, then restart with `npm run dev`. Open **AI Settings**, enter your personal Groq key there, test and save it, then open **Chat**. Provider usage may incur charges. No shared developer key is used. See [M1.5 setup, API, key rotation and acceptance](docs/10-m1-5-ai-provider-foundation.md). NVIDIA is not yet implemented. AI configuration is optional for tasks and reminders.

For local development see [the runbook](docs/runbook.md), [M0 scope and open decisions](docs/m0-plan.md), and [M0 verification results](docs/m0-results.md).

1. Read `AGENTS.md` at the repository root.
2. Read `docs/00-master-context.md`.
3. Read `docs/01-product-requirements.md` and `docs/02-technical-architecture.md`.
4. Read the remaining specifications before implementing the corresponding milestone.
5. Continue one verified milestone at a time. M1.5 is the current slice; stop for review before M3. Do not build the whole product in one pass.

## Document index

| File | Purpose |
|---|---|
| `AGENTS.md` | Mandatory operating rules for the coding agent |
| `docs/00-master-context.md` | Canonical product context, goals, principles, and decisions |
| `docs/01-product-requirements.md` | User stories, scope, requirements, acceptance criteria |
| `docs/02-technical-architecture.md` | Architecture, stack, boundaries, deployment assumptions |
| `docs/03-database-and-memory.md` | Data model, memory semantics, migrations, retention |
| `docs/04-security-and-approvals.md` | Authorization, approvals, secrets, audit, privacy |
| `docs/05-reminders-and-reliability.md` | Scheduler, delivery state machine, retries, fallback |
| `docs/06-api-and-integrations.md` | API conventions, contracts, integration behavior |
| `docs/07-ui-ux-specification.md` | Screens, interaction rules, responsive behavior |
| `docs/08-implementation-roadmap.md` | Milestones and dependency order |
| `docs/09-test-plan-and-acceptance.md` | Test strategy and release gates |
| `docs/decisions/architecture-decisions.md` | Decisions made and decisions intentionally left open |

## Important status labels

- **DECIDED:** A requirement that should be implemented as written.
- **PROPOSED DEFAULT:** A pragmatic initial implementation choice. Keep it configurable where practical and record a decision if changing it.
- **OPEN DECISION:** Do not silently invent a product policy. Implement an interface/configuration seam or ask the owner before locking it.

## Core release principle

AXIS is not allowed to claim that a reminder, integration, backup, or external action is reliable merely because code exists. Reliability must be demonstrated with automated tests and, where relevant, a documented end-to-end or recovery test.

The MVP must not be considered releasable if a critical reminder can be lost without detection, an approval can be bypassed, duplicate consequential actions can occur, or a restore test fails.
