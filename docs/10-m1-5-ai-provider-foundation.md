# M1.5 — AI provider foundation (BYOK)

Status: implementation and automated acceptance passed; actual-provider acceptance pending. M1.5 is not yet marked fully complete.

Subsequent multi-user milestone (2026-10-12): verified Google signup is now supported. References below to deferred onboarding describe the original M1.5 boundary and are superseded by ADR-017 and `multi-user-results.md`. BYOK remains isolated per user.

## Scope and audit

Reuse React/Vite dashboard, Express session and CSRF middleware, Zod, Kysely parameterized SQL, PostgreSQL migrations, structured content-free logs and existing test harnesses. Existing memory supports PostgreSQL full-text search. No previous AI integration or credential encryption exists. M1 and M2 remain separate from inference. No tools, actions, automatic memory writes, fallback providers, or SaaS onboarding are added.

Acceptance requires encrypted per-owner configuration, real adapter requests, settings and persistent chat, bounded authorized context, isolation/error/replay tests and M1/M2 regression checks. Actual personal-key verification is a separate manual gate; synthetic tests cannot satisfy it.

## Decisions

One active configuration per owner. Groq is the initial adapter, with maintained models `llama-3.1-8b-instant` and `llama-3.3-70b-versatile`. NVIDIA remains pending a separately verified implementation. Fixed Groq HTTPS endpoint, redirects forbidden; no custom URLs or tools. Model availability and account entitlement must be checked through Test connection.

Missing master key disables AI only, returning a clear configuration error. Invalid supplied configuration fails API startup. This reconciles fail-closed credential handling with the requirement that the app remain useful without AI. The reminder worker never loads AI configuration. Production onboarding remains single owner; isolation tests use synthetic distinct users.

Context is opt-in per message, bounded, read-only, excludes sensitive and archived memories, retains truth labels and provenance. It is untrusted data, not system policy. Chat responses are unverified plain text.

## Provider contract sources

Reviewed official [Groq chat API](https://console.groq.com/docs/api-reference), [models](https://console.groq.com/docs/models), and [errors](https://console.groq.com/docs/errors). Non-streaming chat uses Bearer authentication and `max_completion_tokens`. No live requests are made by automated tests.

## Storage, security and recovery

Migration `004-ai` adds `ai_configs`, `ai_conversations`, `ai_messages`, `ai_requests`, and `ai_rate_windows`; readiness advances to schema 4. Ownership foreign keys bind messages and requests to their conversation owner. Configuration is unique per user, with a UUID identity and revision. The raw key is only decrypted on the backend execution path, not returned to the frontend, prompts, or logs.

AES-256-GCM uses a fresh 12-byte nonce and 16-byte authentication tag. AAD binds the envelope to owner, provider and master-key version. The envelope stores ciphertext, nonce, tag and version. The 32-byte master key is base64 in server configuration. Database backups contain ciphertext; protect .env/keyring backups separately. Loss of the master key means credentials must be re-entered. Removing a saved key does not revoke it at Groq, erase old backups or recall already started calls. Restrict backup retention and filesystem access.

Every chat message has a client-generated UUID request ID, payload hash, persisted status and one user message. User-row transactions serialize registration. Replaying the same request returns existing history; changing content with that ID is rejected. Different simultaneous messages in one conversation conflict. Confirmed rejections allow an explicit retry of the latest failed message, at most three total calls; no duplicate user message. A network loss, timeout, malformed success or 5xx becomes unknown and cannot retry. A pending request abandoned by a process becomes unknown after two minutes on the next status/history/chat read. No sweeper or in-memory recovery timer is required. Unknown output cannot be recovered from Groq; the user must check provider usage before intentionally submitting a new request.

Configuration changes apply to requests registered afterward. Deleting/replacing a key cannot recall a request already registered. Provider requests run outside database transactions. Late results cannot change a request already marked unknown. Read-only status polling never dispatches a provider request.

History is capped at the latest 100 messages in the UI and 100 conversations in the selector. Prompts use at most 12 recent messages / 16,000 characters plus at most 6,000 characters of opt-in retrieved context (4 memories, 3 tasks, 2 projects). PostgreSQL full-text search provides lexical relevance, not semantic search. Sensitive and archived memories are excluded. Task/project inclusion is explicitly consented by the checkbox; those records have no sensitivity classification in M1. Known credential patterns and the current key are rejected in chat/context; this is a conservative guard, not a complete secret detector. The user must avoid pasting other credentials or private data they do not want persisted/shared. No automatic memory writes occur.

AI responses render as escaped plain text. Tool-call responses are rejected; tool-shaped text remains inert. Stored context may try prompt injection; it cannot grant tools or backend permissions. Model factual accuracy and instruction adherence are not guaranteed.

## Local setup

From the repository root:

```powershell
npm run setup:ai
npm run dev
# Second terminal, for reminders:
npm run dev:worker
```

`setup:ai` generates the server encryption secret in ignored `.env` without printing it, preserves unrelated settings, and never replaces an existing nonempty setting. Back up `.env` securely. Do not run setup to rotate an existing key. `dev` starts local PostgreSQL as needed, migrates, builds, and starts the API/dashboard at http://localhost:3000. Existing Google owner setup remains required. Open AI Settings and enter the provider key there, never in chat or source control. No provider key is read from shared server environment variables.

For separate development processes, migrate first (`npm run db:migrate`), run `npm run dev:api`, and run `npm run dev --workspace @axis/web` for the existing Vite development proxy. This alternate setup requires `APP_ORIGIN` and the Google redirect URI to match the browser's Vite origin (normally `http://localhost:5173`) rather than port 3000; use the same hostname consistently. The recommended `npm run dev` setup serves the built frontend at port 3000. Keep `npm run dev:worker` separate. Production HTTPS, deployment and paid infrastructure remain unapproved.

| Environment variable            | Meaning                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `AI_CREDENTIALS_ENCRYPTION_KEY` | Required to enable AI; base64 encoding of 32 random bytes.                                    |
| `AI_CREDENTIALS_KEY_VERSION`    | Current version, default `v1`; 1–32 alphanumeric, underscore or hyphen characters.            |
| `AI_CREDENTIALS_PREVIOUS_KEYS`  | Optional JSON object mapping previous versions to base64 master keys. Never log or commit it. |
| `AI_REQUEST_TIMEOUT_MS`         | Default 20000; range 1000–60000.                                                              |
| `AI_REQUESTS_PER_MINUTE`        | Per-user DB-backed shared limit for chat and tests, default 20; range 1–100.                  |
| `AI_MAX_OUTPUT_TOKENS`          | Default 1024; range 64–4096. Connection tests use 8.                                          |

## Master-key rotation

1. Stop all API processes; the reminder worker may remain running. Make protected database and keyring backups.
2. Generate a new independent 32-byte key using a trusted secret manager or local crypto utility; do not print or send it to the coding agent. Assign a new version such as `v2`. Put the new key in `AI_CREDENTIALS_ENCRYPTION_KEY`, set `AI_CREDENTIALS_KEY_VERSION=v2`, and retain the old key under `v1` in `AI_CREDENTIALS_PREVIOUS_KEYS`. Never reuse a version for different key material.
3. Run `npm run ai:rotate-keys`. It locks and re-encrypts all configurations in one transaction. Any failure rolls back every change and reports only a safe diagnostic. No keys are printed.
4. Start the API and test a saved connection through the UI. Keep old keys available in restricted backup storage for old database backups; remove them from the active keyring only after all current rows have rotated and restore procedures account for older backups.
5. On failure, keep the old keyring and database intact, fix configuration and rerun. Never delete old key material as a troubleshooting step. Larger datasets require a reviewed batch-rotation strategy; this is a single-owner baseline.

## API contract

All routes use `/api/v1`, current authenticated owner, no-store responses, existing session/CSRF/Origin protection and 32 KB body limit. No client owner ID or endpoint URL is accepted. Invalid payloads are 400; inaccessible records are 404; missing AI configuration is 503; conflicts are 409; local rate limits are 429. Provider failures for recorded chat are returned as durable result states, not opaque HTTP failures.

| Method and route            | Contract                                                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ai/providers`         | Enabled flag, implemented provider and maintained model registry.                                                                                                                                                                                                          |
| `GET /ai/config`            | `{config}` safe metadata or null; never ciphertext or key.                                                                                                                                                                                                                 |
| `PUT /ai/config`            | `{provider,model,apiKey?}`; omitted key retains existing provider key. Replacement/model change resets validation.                                                                                                                                                         |
| `DELETE /ai/config`         | Delete owner's configuration; 204.                                                                                                                                                                                                                                         |
| `POST /ai/test`             | `{consent:true}` tests saved configuration; `{provider,model,apiKey,consent:true}` tests an unsaved draft. Tiny real generation may incur provider usage. No automatic retries.                                                                                            |
| `GET /ai/conversations`     | Owner's latest 100 conversation summaries.                                                                                                                                                                                                                                 |
| `GET /ai/conversations/:id` | Latest 100 messages and request states.                                                                                                                                                                                                                                    |
| `GET /ai/requests/:id`      | Read-only recovery by request UUID with conversation ID and history.                                                                                                                                                                                                       |
| `POST /ai/chat`             | `{request_id,conversation_id?,message,include_context?,retry?,consent:true}`. Message max 4000 characters. Returns request ID, conversation ID, messages and states. `retry:true` only retries a known eligible failed request with the original content and context flag. |

Config metadata includes provider/model, revision, key-configured flag, validation status/time and updated time. Connection success means one test request worked at that time, not guaranteed future availability. Safe usage counts accompany assistant messages. Content-free audit records cover save/delete/test/chat outcomes; structured logs include generated correlation ID, status and error category, never prompts, keys or provider bodies.

## Manual actual-provider acceptance (pending)

1. Sign in as the configured Google owner. Open AI Settings, select Groq and an allowlisted model, and enter your personal key in the password field.
2. Consent to the tiny test call, click Test entered key, and verify a successful actual-provider response. Save settings; verify the input clears. Click Test saved connection and verify success.
3. Reload; confirm provider/model and status persist, and the key input stays empty. Inspect the configuration response only: it must contain no original key or ciphertext. Do not save network captures of the key submission.
4. Open Chat, send a harmless question, and confirm an actual model answer. Reload, select the saved conversation, and continue it.
5. Create an ordinary memory containing a unique harmless term; ask about that term with context enabled. Verify relevant context appears. Use confirmed/assumed/suggested labels appropriately. Verify sensitive/archived records are not included (automated capture tests cover exact prompts).
6. Replace the key, test again, then delete it and confirm new chat fails safely. Deletion does not revoke provider-side access. Invalid keys and quota errors must produce safe actionable errors; do not intentionally exhaust paid quota to test rate limiting—use the synthetic suite.
7. Two-user live onboarding is unavailable because M1 is single owner. Automated tests with two synthetic users verify isolation; production multi-user onboarding and live separate-account acceptance remain deferred.
8. Stop/disable AI and run the reminder worker: due mocked reminders must still deliver. Run the regression commands below.

```powershell
npm run check
npm run build
./scripts/verify-local.ps1
./scripts/verify-local.ps1 -Browser
npm audit --audit-level=high
```

Automated tests never contact Groq, use personal keys or incur provider charges. See `m1-5-results.md` for actual results, failures encountered and remaining gates. Stop after this milestone; M3/M4 are not included.
