# AXIS — API and Integration Contracts

**Version:** 1.0 | **Contract-first guidance; endpoint names are proposed**

## 1. API conventions

- Base path: `/api/v1`.
- JSON request/response unless an integration requires another format.
- Runtime validation for every request.
- Authenticated user scope from session/token only; never trust a client-supplied `user_id`.
- Standard errors: `{ "error": { "code": "...", "message": "...", "requestId": "..." } }`.
- Use ISO 8601 timestamps; return UTC timestamps and timezone where local interpretation matters.
- Paginate list endpoints.
- Use idempotency keys for retryable create/execute operations.
- Avoid returning secrets or raw provider payloads.
- Version contracts; do not break webhooks silently.
- Generate OpenAPI documentation from implementation or maintain it alongside schemas.

## 2. Proposed endpoint groups

### Health
- `GET /health/live` — process is alive.
- `GET /health/ready` — dependencies required for readiness are available.
- `GET /api/v1/system/status` — authenticated owner-facing status of worker, reminders, integrations, and recent failures.

### Assistant and capture
- `POST /api/v1/assistant/messages` — submit a user message and receive a response plus structured proposed changes.
- `POST /api/v1/capture` — parse/capture task, memory, or commitment.
- `GET /api/v1/conversations`
- `GET /api/v1/conversations/:id/messages`

The assistant endpoint must not be a generic unrestricted tool executor. Domain mutations must go through validated services.

### Memory
- `GET /api/v1/memories`
- `POST /api/v1/memories`
- `GET /api/v1/memories/:id`
- `PATCH /api/v1/memories/:id`
- `DELETE /api/v1/memories/:id`
- `POST /api/v1/memories/search`

Search results should include scope, truth status, source/updated time, and archive status. Sensitive memory creation must enforce consent policy.

### Projects and tasks
- `GET|POST /api/v1/projects`
- `GET|PATCH|DELETE /api/v1/projects/:id`
- `GET|POST /api/v1/tasks`
- `GET|PATCH /api/v1/tasks/:id`
- `POST /api/v1/tasks/:id/complete`
- `POST /api/v1/tasks/:id/defer`
- `POST /api/v1/tasks/:id/reschedule`
- `GET /api/v1/tasks/:id/events`

Do not allow arbitrary status transitions that violate domain rules.

### Reminders
- `GET|POST /api/v1/reminders`
- `GET|PATCH /api/v1/reminders/:id`
- `POST /api/v1/reminders/:id/cancel`
- `POST /api/v1/reminders/:id/snooze`
- `GET /api/v1/reminders/:id/attempts`

Reminder creation returns the persisted record and current delivery policy. A “scheduled” response means a durable record/job exists, not that the message has been sent.

### Plans
- `GET /api/v1/plans/current`
- `POST /api/v1/plans/generate`
- `POST /api/v1/plans/:id/accept`
- `POST /api/v1/plans/:id/reject`
- `PATCH /api/v1/plans/:id`

Plan generation proposes time blocks; acceptance updates AXIS records. Any external calendar write still requires an action proposal and approval.

### Approvals and actions
- `GET /api/v1/approvals`
- `GET /api/v1/approvals/:id`
- `POST /api/v1/approvals/:id/approve`
- `POST /api/v1/approvals/:id/reject`
- `POST /api/v1/actions/:id/execute` (internal/service protected; never public as an unguarded endpoint)
- `GET /api/v1/actions/:id/status`

Approval and execution endpoints must enforce the security policy in `docs/04-security-and-approvals.md`.

### Integrations
- `GET /api/v1/integrations`
- `POST /api/v1/integrations/:provider/connect`
- `POST /api/v1/integrations/:provider/disconnect`
- `POST /api/v1/webhooks/whatsapp`
- `POST /api/v1/webhooks/email` if provider supports callbacks
- `POST /api/v1/webhooks/calendar` only if needed and securely verified

OAuth callback endpoints must validate state and redirect allowlists. Webhook endpoints must verify signatures and deduplicate events.

## 3. Error codes (minimum)

- `VALIDATION_ERROR`
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `APPROVAL_REQUIRED`
- `APPROVAL_EXPIRED`
- `PAYLOAD_MISMATCH`
- `ACTION_ALREADY_CONSUMED`
- `INTEGRATION_DISCONNECTED`
- `PROVIDER_RATE_LIMIT`
- `PROVIDER_TIMEOUT_UNKNOWN`
- `RETRY_EXHAUSTED`
- `INTERNAL_ERROR`

Do not reveal internal stack traces or secrets in user-facing errors.

## 4. WhatsApp adapter

- Start in Twilio Sandbox/test configuration.
- Verify inbound webhook signatures.
- Bind the sandbox sender to the configured owner.
- Normalize inbound messages into a channel-neutral message contract.
- Store provider message IDs and status callbacks.
- Keep outbound send, delivery status, and approval parsing separate.
- Do not assume the Sandbox has the same capabilities or delivery guarantees as production WhatsApp.
- Avoid production outreach or sending to third parties without explicit owner authorization.
- Production onboarding, template approval, consent and region constraints must be validated before launch.

## 5. Email adapter

- Provider choice is open.
- Require a verified destination address and explicit owner configuration.
- Use for fallback when WhatsApp delivery is unconfirmed.
- Store provider message ID, accepted/sent status, delivery callback if available, and error category.
- Keep one logical fallback per reminder/channel unless a documented policy says otherwise.
- Do not send private reminder content in subject lines or previews unless appropriate.

## 6. Google Calendar

- Read-only first.
- Request least-privilege read scopes.
- Import fixed commitments as read-only calendar-derived blocks with provider references.
- Do not write/update/delete external calendar events in the initial configuration.
- If write capability is later enabled, every write is a proposed action requiring explicit approval and an immutable payload.
- Handle token revocation, sync errors, timezones, and duplicate events.

## 7. Model provider adapter contract

Implemented M1.5 routes and contracts are specified in `10-m1-5-ai-provider-foundation.md`: `/api/v1/ai/providers`, `/ai/config`, `/ai/test`, `/ai/conversations`, `/ai/conversations/:id`, `/ai/requests/:id`, and `/ai/chat`. They reuse owner authentication, CSRF and Origin validation. Only Groq is exposed; no automatic fallback or tools exist.

Create a provider-neutral interface for:
- Text generation.
- Structured extraction.
- Optional embeddings.
- Optional transcription/speech.

Requirements:
- Timeouts and bounded retries.
- Provider/model identifier in metadata.
- Capability negotiation; do not assume every provider supports structured output or tool calling.
- Schema validation after every structured response.
- Fallback only to an explicitly configured provider and compatible capability.
- Respect data-handling restrictions when changing providers.
- Avoid logging full prompts or private context by default.

## 8. n8n boundary

Use n8n for bounded integrations and workflow orchestration where it saves time. Call authenticated AXIS APIs. Do not store the canonical task/reminder/approval state solely in n8n. Do not allow an n8n workflow to bypass the approval gate. Store workflow versions and credentials securely; test replay behavior.

## 9. Contract tests

- Auth and owner scope.
- Validation failures.
- Pagination.
- Idempotency on create/execute.
- Webhook signature and duplicate events.
- Provider timeout/unknown outcome.
- Approval expiry and payload mismatch.
- Integration disconnect/revocation.
- No secret leakage in responses.
