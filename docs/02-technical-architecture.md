# AXIS — Technical Architecture

**Version:** 1.0 | **Approach:** Modular monolith + independent worker

## 1. Recommended architecture

Start with a small modular monolith. Keep modules and integration adapters separate in code, but do not split into multiple deployable services until a real scaling or isolation need appears.

```text
Web app (React)
   | HTTPS / authenticated API
   v
Node.js API (Express, TypeScript)
   |-- Auth / user scope
   |-- Assistant orchestration / model adapters
   |-- Memory / search
   |-- Tasks / projects / planning
   |-- Reminders / delivery policy
   |-- Approvals / action execution gate
   |-- Integrations / webhooks
   |-- Audit / observability
   |
   v
PostgreSQL (source of truth)
   ^
   | claims due work, writes delivery outcomes
Worker / scheduler (separate process)
   |-- due reminders
   |-- retries and email fallback
   |-- recurring tasks
   |-- morning briefing jobs
   |-- reconciliation / health checks
   |
   +--> WhatsApp provider adapter (Sandbox first)
   +--> Email provider adapter
   +--> Optional n8n workflows for bounded integrations
   +--> Optional model provider adapters
```

The web app and worker may live in the same repository and share domain packages. They must be independently runnable processes so model or web API outages do not stop scheduled work.

## 2. Proposed stack

These are recommended implementation defaults, not a mandate to provision specific paid services.

- Frontend: React + TypeScript + Vite.
- UI: Tailwind CSS or another consistent accessible component system.
- Backend: Node.js + TypeScript + Express.
- Database: PostgreSQL.
- Data access: a typed ORM/query builder with migrations (choose one and document why; do not mix ORMs).
- Validation: runtime schemas for API payloads and model outputs.
- Worker: Node process using database-backed job claiming and retry schedules.
- Integrations: provider adapters; n8n can orchestrate selected workflows but must not become the source of truth.
- WhatsApp: Twilio Sandbox initially, subject to current account and region constraints.
- Email: provider adapter, provider choice OPEN.
- AI: configurable model-provider interface with bounded fallback.
- Search: PostgreSQL full-text search first; evaluate pgvector only when retrieval evaluation demonstrates value.
- Tests: unit, integration, API contract, browser/e2e, security and recovery tests.
- Deployment: free-tier-first, managed PostgreSQL if available, with limits documented. Validate backups, worker sleep behavior, cron guarantees, and outbound messaging before selecting a host.

## 3. Repository layout

```text
axis/
├── AGENTS.md
├── README.md
├── .env.example
├── package.json
├── apps/
│   └── web/
├── services/
│   ├── api/
│   └── worker/
├── packages/
│   ├── shared/
│   ├── config/
│   └── domain/
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── scripts/
├── workflows/
│   └── n8n/
├── tests/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── recovery/
└── docs/
```

Keep initial structure pragmatic. If the agent selects a monorepo tool, document the choice and preserve the boundaries above.

## 4. Domain boundaries

- **Identity:** user identity, sessions, authorization scope.
- **Memory:** facts/preferences, provenance, confidence, search, correction/deletion.
- **Projects:** project metadata and project-scoped context.
- **Tasks:** actionable work, recurrence, dependencies, status history.
- **Planning:** time constraints, time blocks, proposals, plan acceptance.
- **Reminders:** due times, scheduling, delivery policy and status.
- **Notifications:** provider send attempts, webhook status, email fallback.
- **Approvals:** immutable action proposal, approval lifecycle, risk gate.
- **Actions:** adapters that execute explicitly approved external operations.
- **Integrations:** credentials references, connection health, inbound webhooks.
- **Audit:** append-only security and action events.
- **Assistant:** language understanding, retrieval, tool selection, response synthesis. It coordinates domain APIs; it does not bypass them.

## 5. Source-of-truth rules

PostgreSQL is authoritative for tasks, reminders, plans, approvals, delivery attempts, integration metadata, and audit events. Chat transcripts and model context are not authoritative. External providers are authoritative for provider-side delivery/action outcomes, which must be reconciled into AXIS.

n8n may call approved APIs and transform data, but it must not keep a separate, conflicting copy of reminder/task state or directly execute high-impact actions without the backend gate.

## 6. Worker and scheduling design

- Persist due jobs or derive due work from reminder records.
- Claim work atomically (e.g. row locking / skip-locked pattern or equivalent) so multiple workers do not process the same item.
- Use leases/claim expiry so a crashed worker's job can be reclaimed.
- Record attempt ID, provider, idempotency key, timestamps, result, provider message ID, and error category.
- Use bounded retries and backoff; avoid infinite loops.
- A model outage must not prevent a reminder with a known message template from sending.
- Morning briefing generation can use the model, but the job itself and retry state are durable.
- After deploy/restart/restore, reconcile due and overdue jobs without flooding the user.
- Use a fake clock in tests to exercise schedules and expiry.

## 7. AI orchestration

M1.5 implements only non-streaming read-only chat through per-user Groq BYOK. No fallback or tools are enabled. The broader tool/fallback guidance below applies to future reviewed milestones; it does not authorize them in M1.5. See ADR-016.

- Use provider-neutral interfaces for generation, embeddings (if added), transcription, and speech.
- Validate structured outputs before domain writes.
- Give the model tools that call narrowly scoped domain services, not raw unrestricted database or shell access.
- Tool authorization is enforced server-side regardless of what the model says.
- Distinguish retrieval facts from model inference.
- Keep prompts/version identifiers and non-sensitive model metadata for debugging; avoid logging full private context by default.
- Provider fallback must respect model capabilities and privacy policy. Do not send sensitive data to another provider without the same allowed data-handling posture.
- Use bounded timeouts and token/cost budgets; do not retry endlessly.

## 8. Security boundaries

- Authentication and authorization are separate from model reasoning.
- Verify WhatsApp webhook signatures using provider guidance.
- Never trust sender phone number alone without binding it to the configured owner and validating the channel flow.
- Secrets live in deployment secret storage/environment variables, not the database as plaintext or source code.
- Apply least privilege and allow credentials to be revoked.
- Sanitize rendered content and defend against prompt injection from ingested data.
- Apply rate limits to login, capture, webhook and action endpoints.
- Use secure cookies/session strategy appropriate to selected auth approach.
- Redact secrets and sensitive payloads from logs.
- Enforce per-user ownership in every query; design future tenant isolation from day one.

## 9. Deployment and operations

Before choosing a host, verify:
- API process uptime and sleep behavior.
- Worker process support and scheduled execution guarantees.
- PostgreSQL backup/export availability and retention.
- TLS, secrets, log access, outbound provider connectivity.
- Webhook HTTPS reachability.
- Cost after free quota and behavior when quota is exhausted.
- Restore procedure and measured recovery time.

Keep staging/sandbox separate from production. A deployment is not complete until health checks, migrations, webhook setup, worker execution, backup, and restore procedures are tested.

## 10. Architecture decisions to record

Record each decision with date, context, chosen option, alternatives, consequences, and revisit trigger. Do not silently change database, auth, worker, provider, or approval architecture.
