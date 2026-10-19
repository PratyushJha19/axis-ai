# M4.5 verification — 2026-10-18

Implemented scope: durable internal agent runs, ten server-registered tools,
existing BYOK text adapter, M4 approval handoff/resumption, and Chat controls.
External connectors and M5 planning were not implemented. No deployment, paid
infrastructure, live inference or real messages were used for verification.

## Files and migration

- `database/migrations/010-agent-runs.ts`: runs and tool history, owner foreign
  keys, durable request keys and step uniqueness. Registered in
  `database/scripts/migrator.ts`; readiness updated in `packages/database/src/index.ts`.
- `packages/shared/src/agent.ts`: strict request/decision contracts and view types.
- `packages/domain/src/agent.ts`, `agent-tools.ts`: owner-scoped run service and
  registry. `ai.ts` and `ai-provider.ts` reuse encrypted BYOK with JSON-text
  capability. `approvals.ts` and `chat-actions.ts` support composition inside the
  existing transaction, without creating a second approval gate.
- `services/api/src/agent-routes.ts`, `app.ts`: protected run APIs.
- `services/worker/src/agent-runtime.ts`, `agent-main.ts`: bounded durable runtime
  and separate process. `package.json` adds `dev:agent`; `.env.example` documents
  optional limits. No new dependencies.
- `apps/web/src/Agent.tsx`, `AI.tsx`, `App.tsx`, `Approvals.tsx`: run controls,
  consent, context selection, outcome display and exact proposal navigation.
- `tests/unit/agent.test.ts`; `tests/integration/agent-scenarios.ts`,
  `agent-process-fixture.ts`, `database.test.ts`, `multi-user-scenarios.ts`;
  `tests/e2e/agent.spec.ts`, `server.ts`: new coverage and mock agent execution.
- README, setup guide, master context, API contracts, roadmap, ADR-024,
  `13-m4-5-agent-runtime-tool-execution.md`, and this report document the slice.
  Existing M4/UI edits were preserved.

## Commands and evidence

- `./scripts/verify-local.ps1`: **90 passed, 0 failed** against clean isolated
  database `axis_test_4fe50bdc8733`, retained for inspection. Repeat migrations and
  actual PostgreSQL stop/start persistence checks also passed. Earlier 89-test
  run passed before adding explicit concurrency/deadline/resource-limit coverage.
- `npm audit --audit-level=high`: **0 vulnerabilities**.
- `npm run check`: formatting, lint and both TypeScript checks passed; **36 unit
  and security tests passed, 0 failed**. `npm run build` passed.
- `./scripts/verify-local.ps1 -Browser`: **7 passed, 0 failed** across agent,
  AI settings/chat, dashboard CRUD, multi-user isolation, notifications and two
  reminder workflows. Database `axis_test_e2e_9d6a487368ea` is retained for inspection.
  The agent flow proves no task before approval and exactly one after execution.
- An earlier non-escalated security test was blocked by sandbox
  loopback `EACCES`; it was rerun with local-network permission. This was not
  counted as a passing run. The first browser agent test exposed a test selector
  issue; changing it to the labelled combobox corrected the test.

Coverage includes strict protocol/arguments, unsupported and disabled tools,
cross-owner records and APIs, CSRF, ordinary/project memory isolation, proposal
waits across reconnection, approval-only no-effect, actual execution resumption,
concurrent claims and M4 execution, cancellation during inference, cancellation
of pending proposals, rejected approval, malformed replies, deleted keys, provider
uncertainty, hung inference, iteration/tool/token/deadline limits and read timeout.
Real child-process exits test interrupted inference, committed approval waits and
saved read results. Existing M0–M4 integration regressions are included.

## Run locally

Stop existing AXIS processes before applying migration 010. In three terminals:

```powershell
npm run dev
```

```powershell
npm run dev:worker
```

```powershell
npm run dev:agent
```

Open http://localhost:3000. Save your own Groq key/model in AI Settings and use
Chat → Delegate a task. Review proposals in Approvals, then approve and execute.
API/dashboard, reminder delivery and agent execution are separate processes.
The optional Vite frontend development setup remains supported as before.

Reuse existing database, Google authentication and AI encryption settings. Each
user's provider credential stays encrypted in PostgreSQL. Optional `AGENT_*`
limits and ranges are in the milestone specification; no secrets belong in docs.

## Limitations and manual checks

- No live Groq workflow was verified. JSON adherence varies by selected text
  model; malformed replies fail explicitly. No native tool calling is required.
- Calendar, external writes, task updates, note writes and fresh high-risk
  authentication remain unavailable. The unresolved high-risk policy grants no
  runtime authority. Telegram remains a notification channel, not agent chat.
- Cancellation does not undo executed work or recall in-flight inference.
  Unknown inference is not automatically retried. Provider-reported token usage
  is a budget signal; iteration and content-size bounds remain mandatory.
- No automatic agent history deletion policy or dedicated agent heartbeat UI is
  introduced. Inspect run state and the separate agent process logs. The reminder
  worker health command is not an agent health check.
- Only isolated test databases were migrated during this work. Development
  migration/startup and a user-consented live-provider workflow remain local checks.
- Stop at M4.5 for review. M5 has not been started.
