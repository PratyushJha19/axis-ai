# AXIS — Architecture Decision Log

Record material choices here. Do not silently replace decisions.

## ADR-001 — Product form

- **Status:** Accepted
- **Decision:** AXIS is a personal AI operating system plus autonomous digital employee, initially single-user with future multi-user isolation in mind.
- **Reason:** Reduce cognitive load and coordinate memory, tasks, reminders, plans, and integrations.
- **Consequence:** Build a secure single-user MVP without hard-coding user identity into domain models.

## ADR-002 — Modular monolith first

- **Status:** Accepted as initial direction
- **Decision:** Use a modular monolith for API/domain code and a separate worker process.
- **Reason:** Keeps deployment and maintenance manageable while protecting scheduler independence.
- **Revisit when:** Real scaling, availability, or isolation evidence justifies service separation.

## ADR-003 — Database is source of truth

- **Status:** Accepted
- **Decision:** PostgreSQL is authoritative for tasks, reminders, approvals, plans, delivery attempts, integrations metadata, and audit events.
- **Reason:** Chat and model context are not durable or transactionally reliable.
- **Consequence:** n8n and model context cannot become competing sources of truth.

## ADR-004 — Approval-gated external actions

- **Status:** Accepted
- **Decision:** All external-state-changing actions require explicit approval; high-risk actions also require fresh web authentication.
- **Reason:** The user wants AXIS to suggest actions but wait for approval.
- **Consequence:** Central backend gate, immutable payload hash, expiry, idempotency, audit and reconciliation are mandatory.

## ADR-005 — Reminder delivery policy

- **Status:** Accepted
- **Decision:** WhatsApp is primary; email fallback is attempted for every reminder whose WhatsApp delivery is not confirmed, under a configurable timeout/retry policy.
- **Reason:** Reminders are the highest-trust product function.
- **Consequence:** Provider status callbacks, unknown outcome, fallback deduplication and operational alerts are required.

## ADR-006 — WhatsApp Sandbox first

- **Status:** Accepted
- **Decision:** Begin with WhatsApp Sandbox; production sender/onboarding is deferred.
- **Reason:** Low-cost controlled testing before production messaging.
- **Consequence:** Clearly label sandbox mode; validate provider capabilities before launch.

## ADR-007 — Calendar read-only first

- **Status:** Accepted
- **Decision:** Calendar integration starts read-only. Calendar writes require explicit approval and are not part of the initial baseline.
- **Reason:** Avoid accidental external schedule changes.
- **Consequence:** Imported events are context, not editable AXIS records.

## ADR-008 — Memory privacy and truth status

- **Status:** Accepted
- **Decision:** Remember routine facts by default; ask before saving sensitive/personal facts. Label facts confirmed, assumed, or suggested.
- **Reason:** Useful memory must remain transparent and user-controlled.
- **Consequence:** Memory items require provenance, scope, status, and inspect/correct/delete UX.

## ADR-009 — Backups and recovery

- **Status:** Accepted target policy
- **Decision:** Daily backups, seven daily copies, monthly isolated restore test, target RPO 24 hours and RTO 4 hours.
- **Reason:** Reminder and commitment records must be recoverable.
- **Consequence:** Validate actual hosting capabilities and reconcile due jobs after restore.

## ADR-010 — Proposed technology defaults

- **Status:** Proposed; confirm in M0 before committing to hosting or paid providers
- **Decision:** React + TypeScript + Vite; Node.js + TypeScript + Express; PostgreSQL; provider adapters; separate worker; n8n for bounded workflows where useful.
- **Reason:** Familiar, practical stack and low operational complexity.
- **Consequence:** Keep integrations and AI providers replaceable.

## Open decisions — resolve before the relevant milestone

1. Auth library/provider and session model: resolved for local M1 by ADR-013; real Google acceptance and deployment session review remain pending.
2. ORM/query builder and monorepo/package manager.
3. Hosting provider, worker uptime, database backup and restore capabilities.
4. Model providers, fallback order, cost limits, privacy compatibility.
5. Email provider, sender domain, verification and fallback timeout/retries.
6. Exact high-risk action taxonomy and web-auth freshness window.
7. Approval revocation behavior once execution begins.
8. Quiet/focus deferral and no urgent bypass are resolved for M2 by ADR-015; real-channel policies remain M3 decisions.
9. Whether PostgreSQL full-text search is sufficient or pgvector is justified.
10. Exact briefing time and reminder offsets.
11. Production WhatsApp provider/sender and launch requirements.
12. Calendar OAuth scopes and token storage approach.

## Decision record template

### ADR-011 — Local M0 implementation foundation

- **Status:** Accepted engineering choice for reversible local M0; owner policies remain open.
- **Date:** 2026-10-10
- **Context:** Documentation-only directory; owner requested a tested M0 and explicitly chose local PostgreSQL over Docker.
- **Options considered:** npm workspaces vs pnpm/Turborepo; Kysely vs Prisma/Drizzle; local PostgreSQL vs Docker; full UI vs backend foundation.
- **Decision:** Node 24, npm workspaces, strict TypeScript, Express 5, PostgreSQL 18 and Kysely with its transactional migration ledger. Use Node test runner, ESLint and Prettier. Keep separate API and worker entry points. Add only a foundation schema marker; defer domain tables and React/Vite UI to M1.
- **Consequences:** No monorepo orchestrator, queue, vector database, n8n deployment or provider SDK. Repository-owned local data stays ignored. API binds loopback; all product API routes deny access. Health checks and logs contain no private records. Worker performs dependency checks only. Runtime execution uses tsx; production packaging is deferred.
- **Revisit trigger:** M1 authentication integration, deployment packaging or demonstrated build complexity.
- **References:** [Kysely PostgreSQL setup](https://www.kysely.dev/docs/getting-started), [Express 5 migration guidance](https://expressjs.com/en/guide/migrating-5/).

### ADR-012 — Defer provider and identity policy while failing closed

- **Status:** Accepted M0 boundary; identity deferral superseded by ADR-013. Hosting/model selection remains open.
- **Date:** 2026-10-10
- **Context:** M0 asks to confirm auth, hosting and model choices, but provider/privacy and security policies need owner decisions. A health-only foundation requires none of those accounts.
- **Options considered:** Provision provider defaults now; invent a development identity; leave all protected capabilities disabled.
- **Decision:** Leave protected capabilities disabled. Proposed M1 identity approach is a maintained auth library with database-backed revocable sessions, secure HTTP-only cookies, CSRF protection and explicit owner enrollment. Library, identity provider and session lifetimes must be resolved before M1. Hosting stays local; no model SDK/calls or fallback provider is selected.
- **Consequences:** M0 implementation can be verified without accounts, credentials from the owner, or external side effects. Full M0 decision sign-off remains outstanding. No pretend authentication or approval gate is presented as completed.
- **Revisit trigger:** Before M1, before any live messaging, or before deployment. Resolve the consented-notification exception versus universal per-action approval in writing before M3 sends anything.

### ADR-013 — Google owner identity and M1 local application

- **Status:** Accepted for local M1; real-provider manual verification pending.
- **Date:** 2026-10-10
- **Context:** Owner selected Google sign-in instead of a local account after requesting the MVP.
- **Options considered:** Local maintained password auth; Google OIDC through a maintained library; hosted authentication service.
- **Decision:** openid-client authorization-code flow with PKCE/state/nonce; require verified OWNER_EMAIL and bind first owner permanently to Google subject. Use express-session/connect-pg-simple with PostgreSQL, 24-hour fixed expiry, HTTP-only SameSite=Lax cookies, Secure on HTTPS, CSRF token plus exact Origin on writes. Ten-minute OAuth challenges are atomically consumed. Identity scopes only; do not retain provider tokens. Add React/Vite as specified, served by the local Express process after build.
- **Consequences:** Owner supplies a Google Web OAuth client privately. Missing auth means private APIs remain denied. Local-only HTTP on loopback is a development exception; deployment/TLS/proxy configuration is unapproved. No generic signup or production test-login switch. Sessions survive app restart and can be revoked at logout.
- **Revisit trigger:** Real Google acceptance, deployment review, M4 fresh authentication, or owner account transfer.

### ADR-014 — M1 persistence, privacy and edit contracts

- **Status:** Accepted engineering choice for M1.
- **Date:** 2026-10-10
- **Context:** Concurrent/retried forms must not duplicate records or overwrite changes; deleted sensitive memory must not remain in caches/audit.
- **Decision:** Owner-scoped parameterized SQL through Kysely; composite ownership foreign keys; complete edit forms with optimistic versions; transaction-bound UUID idempotency keys with payload hash and entity ID. Hard-delete memory. Store content-free append-only audit with database trigger. Runtime schemas shared by API tests and frontend types. No automatic model-driven memory capture in M1.
- **Consequences:** Archive remains searchable on explicit request. Known sensitive/credential patterns are conservatively blocked, and users must classify privacy; comprehensive automatic classification is not claimed. Timezone setup is explicit; due entry uses clearly labelled device timezone and saves UTC plus IANA zone. Domain tables follow numbered migrations; no automatic runtime schema creation.
- **Revisit trigger:** M2 recurrence, large data pagination needs, stronger least-privilege database deployment or evaluated memory classification.

### ADR-015 — M2 database-backed reminders with mocked delivery

- **Status:** Accepted for M2; owner explicitly approved quiet/focus, overdue and mock retry policies.
- **Date:** 2026-10-12
- **Context:** M1 uses Express, Kysely and PostgreSQL, with a separate worker skeleton. M2 must prove scheduling/recovery without contacting notification providers.
- **Options considered:** An external queue vs reminder-driven PostgreSQL claims; in-memory fake delivery vs durable mock receipts; fixed UTC recurrence vs calendar arithmetic in IANA zones.
- **Decision:** Add migration 003. Reminder rows hold their current occurrence, due/next-attempt timestamps and lease token. `FOR UPDATE SKIP LOCKED` claims work; the dispatch transaction rechecks the token, lease, cancellation and owner preferences before recording a sending attempt. Provider calls happen outside transactions, with a timeout below the lease length. Completion is fenced by token and lease; expired dispatches reconcile before retry. The mock provider deduplicates by schedule key plus occurrence and persists receipt IDs without notification bodies. No real channel implementation or fallback is enabled.
- **Scheduling policy:** Owner-configured quiet hours and focus blocks defer every reminder; no urgent bypass. Quiet boundaries cover both appearances of a repeated DST hour. After downtime, process one overdue occurrence, then move daily/weekly recurrence to the next future occurrence and expose the skipped count. Recurrence retains the original wall-clock time and IANA zone; profile changes affect quiet hours and new schedules, not existing recurrence. Snooze changes only the current occurrence's next attempt. Explicit edits start a new occurrence and reset its retry budget. Daily/weekly recurrence uses [Temporal's maintained polyfill](https://github.com/js-temporal/temporal-polyfill); ambiguous/nonexistent times require an earlier/later choice or pause for review.
- **Mock retry policy:** Three send attempts; exponential backoff from 30 seconds with ±20% jitter, capped at 15 minutes. Honor a validated retry-after up to 24 hours. Default lease 60 seconds, call timeout 5 seconds, maximum three reconciliation queries. Unresolved reminders keep their uncertain state, require attention, and stop automatic work; owner may request another bounded reconciliation cycle, never a blind resend. Permanent/configuration failures require attention immediately.
- **Cancellation boundary:** Cancellation committed before the dispatch transaction prevents sending, including after claim. Once dispatch starts, edits/cancel/snooze return conflict until outcome is resolved. The UI does not promise to recall an in-flight operation.
- **Consequences:** API authentication/CSRF/version checks remain unchanged. Worker requires only PostgreSQL, not Google authentication, a web process or an AI provider. Local API launcher now leaves PostgreSQL running on exit so stopping the web app does not stop reminders. No process supervisor, deployment, paid service, live WhatsApp/email, approval executor or backup/restore guarantee is included. Test databases and receipts are retained for inspection. Real-provider idempotency and reconciliation capability must be assessed anew in M3; mock evidence is not a delivery guarantee.
- **Revisit trigger:** M3 provider contracts and approval/notification consent policy, arbitrary recurrence rules, scale/backlog requirements, or production operations review.

### ADR-016 — M1.5 per-owner BYOK and read-only persistent chat

- **Status:** Accepted implementation under the owner's M1.5 specification; live-provider acceptance pending.
- **Date:** 2026-10-12
- **Context:** Existing React/Express/Kysely core has Google owner authentication, PostgreSQL full-text memory and independent reminders but no model integration. The owner requested BYOK after M2.
- **Options considered:** A shared developer API key vs per-owner encrypted keys; AI SDK vs small typed HTTP adapter; semantic/vector retrieval vs existing PostgreSQL search; hidden retries vs explicit persisted outcomes.
- **Decision:** One configuration per owner, UUID revision, AES-256-GCM with owner/provider/version AAD and a server-only keyring; fixed Groq HTTPS endpoint, allowlisted models, no redirects. Migration 004 stores credentials separately from chat and memory. Chat has a durable request UUID and payload hash, transaction registration, bounded history/context and DB-backed user rate limits. Unknown outcomes cannot be resent; only explicit eligible failure retry is supported, capped at three total calls. No provider fallback, tools or memory writes. NVIDIA remains unimplemented and hidden.
- **Specification reconciliation:** Missing master key disables AI, preserving core functionality; malformed supplied AI settings fail API startup. The worker never reads AI configuration. Earlier broad model-fallback/tool guidance is future scope, overridden for M1.5 by the explicit no-fallback/no-tools requirement. No second login or multi-user signup is added; production remains owner-only, while tests prove two-user domain isolation.
- **Consequences:** Inference is an explicitly requested, disclosed provider call, not authorization for any model-generated action. Context sharing is opt-in and excludes sensitive/archived memories. Encryption backups require separately protected key material and versioned rotation. Deletion/replacement affects newly registered calls, not calls already started. Live personal-key validation is performed through the UI and cannot be claimed from mock tests. Hard provider outcomes cannot be reconciled automatically; unknown requests require user attention.
- **Revisit trigger:** Live Groq acceptance, adding NVIDIA, retention/pagination scale, SaaS onboarding, privacy policy for new providers, or M4 action authorization.

### ADR-017 — Verified Google multi-user enrollment

- **Status:** Accepted; owner explicitly chose "Anyone with a verified Google account" on 2026-10-12.
- **Context:** User-owned database rows and BYOK were already isolated, but authentication restricted every session to one global owner binding.
- **Decision:** Replace that admission gate with account creation/reuse by verified Google subject. Preserve OIDC verification, state/nonce/PKCE, session regeneration, 24-hour expiry and CSRF. Atomic `INSERT ... ON CONFLICT(google_subject)` returns one account under concurrent enrollment. Only email metadata updates on returning login; user-edited name/timezone remain intact. Never link accounts by email.
- **Compatibility:** Existing subjects retain user IDs, credentials, records and sessions. OWNER_EMAIL is ignored and removed from setup/template. Retain `owner_binding` solely as historical data, with no authorization role. Existing schema constraints suffice; no new migration or destructive rewrite.
- **Consequences:** Every admitted user has a private workspace, profile/timezone, reminders, conversation history and encrypted AI key. No sharing, admin data access, billing or invitation system. Google audience restrictions remain external prerequisites. Tests use two actual app sessions with synthetic Google identities; live Google acceptance remains manual. Local server stays bound to loopback; no public deployment is implied.
- **Supersedes:** ADR-013 single-owner admission and ADR-016 deferred multi-user onboarding only. All other safety and approval boundaries remain unchanged.
- **Revisit:** Production deployment, abuse/resource quotas, account suspension/deletion, shared workspaces or new identity providers.

### ADR-018 — M3 channel outbox and verified notification consent

- **Status:** Accepted engineering design under the explicit M3 implementation request; live acceptance pending.
- **Date:** 2026-10-12
- **Context:** M2 already owns reminder recurrence, quiet hours, leases and durable attempt history. M3 requires real adapters and fallback without another scheduler.
- **Decision:** Keep M2 scheduling and add a PostgreSQL channel outbox adapter, processed by the same independent worker. Extend existing attempts for per-channel sends. Unique occurrence/channel identities, owner-row dispatch locks, fenced leases and provider-event deduplication guard replay/concurrency. No DB transaction spans network I/O. Twilio and Resend use fixed HTTP endpoints; Twilio SDK and Svix verify signatures. Transport failures and 5xx are unknown; only explicit rate rejection retries automatically. Query known provider references and never blindly resend uncertain dispatches.
- **Consent:** The requested notification settings implement the master's narrow consented-personal-notification exception. Phone ownership requires a signed inbound, single-use linking code; linking alone does not enable reminders. Email requires a fresh verified Google login plus explicit enablement. Fixed channel tests require an authenticated, CSRF-protected request to saved destinations. This does not authorize external actions or arbitrary recipients. Mock is the default; provider credentials do not enable live sends by themselves.
- **Fallback:** Default 300 seconds from first durable primary dispatch; configurable 30–86400 seconds. This allows callback latency above the one-second worker poll. Permanent/configuration failure allows immediate fallback. Reconcile a known primary reference at the deadline; unknown still permits one logical email fallback. Suppress unsent email when delivery confirmation wins dispatch. Late confirmation preserves both histories. Quiet/focus windows defer fallback too. Changing channel settings invalidates queued consent snapshots and makes blocked work visible.
- **Tradeoffs:** Twilio has no assumed send-idempotency guarantee. Resend's finite idempotency retention is supplemental protection, not permission to resend unknowns. Crash after provider acceptance can require a signed callback to recover a missing reference. Exactly-once external delivery is not promised. No provider provisioning, tunnel, deployment or live message is included in implementation.
- **Supersedes:** ADR-015 mock-only transport restriction for explicitly configured M3 live mode; preserves mock default and M2 scheduling semantics. Resolves initial email provider and development fallback policy; production sender/template/domain and live acceptance remain operator setup.
- **References:** [M3 specification and operations](../11-m3-messaging-notifications.md).

### ADR-019 — Telegram replaces active WhatsApp notifications

- **Status:** Accepted, owner requested 2026-10-15.
- **Decision:** Use Telegram Bot API for new personal reminders. Keep the existing
  PostgreSQL scheduler/outbox and worker. Poll with a bot-scoped lease and durable
  cursor committed with updates; no Telegram webhook or automatic webhook removal.
  Link private human chats using hashed one-time ten-minute codes, then require
  explicit dashboard consent. Bot ID is part of the verified destination.
- **Evidence:** sendMessage success is sent, not delivered/read. It settles the
  occurrence and advances recurrence. Unknown sends never retry blindly; no
  applicable delivery lookup exists. Optional email defaults off and is suppressed
  on confirmed Telegram send.
- **Migration:** Preserve WhatsApp history; disable its consent and pending dispatch.
  No automatic recipient/consent conversion or redelivery. Historical adapters
  remain for evidence and regression tests; active worker disables Twilio.
- **Cost:** Standard bot API within current free limits, paid broadcasts explicitly
  disabled. No promise of perpetual pricing or free hosting/email.
- **Limits:** Polling requires a running worker. Incoming updates last 24 hours;
  dashboard disconnect is the durable local opt-out. No conversational AI or M4.
- **References:** `../telegram-setup.md`, `../telegram-results.md`.

### ADR-020 — Dynamic Groq text model selection

- **Status:** Accepted, owner-requested, 2026-10-15.
- **Decision:** Replace the two-model whitelist with validated model IDs and an explicitly requested, per-user catalog lookup using the entered or encrypted saved key. Keep fixed Groq endpoints, bounded responses, authentication, CSRF protection and per-user rate limits. No shared account catalog cache, automatic model fallback, or automatic inference on lookup.
- **Scope:** M1.5 maintenance. Existing text-only chat accepts current/new text model IDs; known audio models and autonomous tool systems are identified separately and rejected by selection validation. Provider account permissions remain authoritative. No schema migration required because the model column is already text.
- **Connection tests:** Up to 1,024 output tokens, subject to the server limit, with existing explicit quota consent. GPT-OSS 20B/120B use low reasoning effort; empty output at the limit has a distinct error. No credentials or raw provider errors are returned.
- **Validation:** See `../groq-model-results.md`. Live account entitlement remains a user-run check.

### ADR-021 — Confirmed local task/reminder creation from chat

- **Status:** Accepted implementation of the owner's 2026-10-15 request.
- **Decision:** Extend chat with strict model-generated drafts for create task and create reminder. Save immutable owner-scoped proposals with 24-hour expiry. Explicit web confirmation consumes the exact payload and creates the record atomically through existing domain functions. Model output cannot supply owner, consent, recipient or arbitrary tools.
- **Safety:** Preserve reminder preview/confirmation, configured timezone, worker and channel consent. Reject invalid/past/ambiguous times and stale timezone previews. No external action policy or high-risk taxonomy is changed; the general M4 executor remains unimplemented.
- **Compatibility:** A JSON envelope uses ordinary text completions without native tool support. Invalid outputs never become writes. Model prose is not creation evidence; backend status is shown separately. Schema 7 adds proposals and an immutability trigger.
- **Supersedes:** ADR-016 and M1.5 read-only restrictions only for these two explicitly confirmed internal creations. No broader automation or memory writes.
- **Evidence:** `../chat-actions.md`; live model interpretation remains a manual acceptance check.

### ADR-022 — Finished reminder archive and seven-day retention

- **Status:** Accepted, explicitly requested by the owner on 2026-10-16.
- **Decision:** Automatically archive cancelled reminders and settled one-time reminders. Default list is active; archive is a separate owner-scoped view. Persist archive time via migration 008 and a state trigger. Existing finished records receive seven days from migration, rather than immediate deletion.
- **Retention:** Worker cleanup deletes archived reminders and child delivery details after seven days, in bounded atomic batches. Leased, scheduled or unresolved transport work prevents deletion. Preserve content-free audit/idempotency/deduplication evidence and separate chat history. No external message deletion or resend is authorized.
- **Consequences:** Worker availability determines when eligible deletion happens. Recurrence with future work and unresolved reminders remain active. Archive has no restore/resend control. Schema readiness becomes 8.
- **Validation:** `../reminder-archive.md` records database, security and browser evidence. This supersedes indefinite reminder-detail history retention for settled/cancelled reminders only.

### ADR-023 — Shared internal approval gate with external operations denied

- **Status:** Accepted limited implementation under the owner's instruction to
  proceed with the available M4 specification, 2026-10-17.
- **Decision:** Extend the existing chat proposal table and gate rather than
  introduce a parallel approval authority. Keep 24-hour immutable expiry,
  owner-scoped idempotency, a server policy version and a canonical database
  SHA-256 security-context digest. Internal task/reminder creation requires
  explicit approval and commits its effect, execution evidence and audit together.
- **Compatibility:** Keep database/chat `succeeded`; expose `executed` through the
  new approval API. Preserve old proposal IDs, payload hashes and chat history.
  Direct authenticated internal CRUD and consented reminder delivery retain their
  existing exceptions. No provider SDK or infrastructure is added.
- **Boundary:** Unknown, external and high-risk actions are denied. A login's
  session expiry is not fresh authentication. The high-risk taxonomy and freshness
  window remain unresolved; no fresh-auth challenge or external executor is
  claimed. Notifications for approvals are dashboard-only.
- **Consequences:** Approval and execution are separate inbox controls; existing
  chat confirmation uses the same gate in one transaction. Failed local writes
  roll back and require a new proposal. No blind retry of unknown outcomes.
  Future network handlers require an explicit durable outbox/reconciliation
  design and high-risk authentication policy before registration.
- **Evidence:** `../12-m4-approval-security-gate.md`.

### ADR-024 — Durable internal agent runs over BYOK text completions

- **Status:** Accepted implementation of the owner's M4.5 request, 2026-10-18.
- **Decision:** Migration 010 persists owner-scoped runs/tool history. Use strict
  JSON decisions through the existing text adapter and a server tool registry.
  Run bounded inference separately from reminder delivery.
- **Authority:** Internal reads are scoped; task/reminder proposals reuse M4.
  Commit proposal association atomically; resume only from execution evidence.
- **Recovery:** Fence leases and late results. Resume saved decisions, but mark
  interrupted inference unknown without blind resends. Separate model prose from
  actual outcomes in the UI.
- **Boundary:** No external connector or high-risk policy is invented. Those
  handlers remain unavailable until their account/permission contracts exist.
- **Evidence:** `../13-m4-5-agent-runtime-tool-execution.md`, `../m4-5-results.md`.

### ADR-025 — Deterministic planning with optional BYOK advice and consented alerts

- **Status:** Accepted engineering design under the owner's M5 specification, 2026-10-19.
- **Decision:** Add migration 011 for versioned preferences/plans, AI generation
  receipts, feedback and durable alert identities. Reuse tasks, projects, memory,
  reminders, audit and the existing worker; no separate scheduler or model loop.
- **Policy:** Availability is empty until supplied; Monday is the configurable
  week start. Estimates are never invented. Accepting a plan reserves internal
  capacity only. Explicit recovery previews and atomically applies task/reminder
  edits through existing domain services under the ADR-023 internal CRUD exception.
- **Authority:** AI advice has validated owner task IDs and no write authority.
  M4.5 gains read tools only; protected creation still requires M4. Calendar and
  other unavailable sources are disclosed, not simulated.
- **Notifications:** Disabled by default, configurable timing, five new personal
  events per local day. Unique event identity plus existing M2/M3 consent/dispatch
  fences prevents repeated queuing and suppresses stale queued source events.
- **Tradeoffs:** Bounded data loads, indivisible time blocks, explicit stale-plan
  rejection, optional AI with deterministic fallback. No automatic AI polling,
  external connectors, deployment or historical analytics expansion.
- **Evidence:** `../14-m5-daily-intelligence-planning.md`, `../m5-results.md`.

### ADR-026 — Read-only Calendar cache and operator-controlled recovery

- **Status:** Accepted engineering implementation of the owner's M6 specification,
  2026-10-20; deployment and live acceptance pending.
- **Decision:** Separate Google consent with state/PKCE/nonce, database single-use
  challenges bound to account/session, same verified Google subject, events-readonly
  scope and primary-calendar reads. Reuse AES-GCM keyring with distinct purpose AAD.
  Cache complete bounded ranges; fence refresh results against disconnect and
  reconnection. Existing planner consumes deterministic busy intervals; no calendar
  text reaches AI, no Calendar write tool exists.
- **Operations:** PostgreSQL custom dumps under an exported consistent snapshot,
  whole-artifact AES-GCM with separate operator key, authenticated manifest metadata,
  checksums, private ACLs and post-verification retention. Restore into a unique local
  database, compare table counts/schema objects and decrypt credentials. New recovery
  databases remain quarantined and have sessions/consent challenges invalidated.
- **Boundary:** No production overwrite, installed scheduler, storage provision,
  remote alert or live provider call. Seven distinct daily points plus one monthly
  point are retained as successful history accumulates. RPO/RTO remain targets.
- **Revisit:** Additional calendars, deployed storage/scheduler/alert provider,
  broader OAuth account linking or future Calendar writes behind M4.

### ADR-027 — Strictly free Vercel/Render demonstration

- **Status:** Owner selected a strictly free demo on 2026-10-20; hosting pending.
- **Decision:** Vercel serves the existing frontend and proxies auth/API paths to
  a free Render web service. Proposed Neon Free PostgreSQL avoids Render's
  30-day free database expiry. Use an empty demo database and simulated delivery.
- **Authority:** Existing sessions, owner isolation, CSRF and approval checks stay
  intact. Explicit HOST and one-hop proxy trust support Render HTTPS ingress;
  defaults remain loopback and no proxy trust. No wildcard CORS is added.
- **Limits:** DEMO_MODE advertises missing background functions, refuses worker
  startup and delegated submissions, and requires mock notifications. Reminder
  records remain editable without a claim of delivery. No paid worker, keep-alive,
  deployment or infrastructure creation is included.
- **Evidence:** `../render-vercel-demo.md`. Hosted OAuth, proxy behavior, cold
  starts and database recovery require later verification.

### ADR template — Title

- **Status:** Proposed / Accepted / Superseded
- **Date:**
- **Context:**
- **Options considered:**
- **Decision:**
- **Consequences:**
- **Revisit trigger:**
