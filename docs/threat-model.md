# Initial threat model

## Multi-user update

ADR-017 replaces the owner allowlist with verified Google enrollment. OIDC subject is the identity key, protected by the existing unique database constraint and atomic upsert. Email changes cannot merge accounts or transfer private data. Every private route still derives identity from its authenticated PostgreSQL session; no client user ID is trusted. Tests exercise real concurrent sessions and cross-user read/write/delete/link attempts for core records, reminders and BYOK/chat. Public signup increases resource-abuse exposure: existing request limits remain, while production-wide quotas, account administration, retention and deployment controls are separate work. No deployment was performed.

## M1 additions

Google OIDC uses openid-client with PKCE, state and nonce. Enrollment requires a
verified allow-listed email and a permanent Google-subject owner binding; no public
signup or production test identity exists. PostgreSQL sessions expire after 24 hours
and logout removes the session. OAuth challenges expire after ten minutes and are
consumed atomically. Google tokens are not retained. Credential setup remains manual.

Private APIs require owner scope, exact Origin and CSRF token on writes. Composite
foreign keys prevent cross-owner project links. Forms reject unknown fields, require
versions on edits/deletes and idempotency keys on creation. Request limits and generic
errors minimize abuse/leakage. Audit rows reject update/delete through a DB trigger.
Local development still uses its database owner role; production must introduce
least-privilege migration/runtime roles and review audit retention before deployment.

Memory requires explicit privacy classification. Sensitive records require consent
on each save; conservative personal-information terms and credential patterns are
checked server-side. This is not complete detection. No model ingests or auto-saves
information in M1. Hard deletion removes content/search entries; audit/idempotency
records retain IDs/hashes only. Frontend fetches private state after authentication,
uses React escaping and has no browser persistent cache or provider credentials.

HTTP is loopback development only. Secure cookies are used for HTTPS origins but
proxy trust/TLS termination has not been configured. Auth/IP rate limits are per
process and are not sufficient for a public multi-instance deployment. Original M0
controls below describe the historical foundation; M1 auth replaces deny-all routes
only when valid configuration and an authenticated owner are present.

## Assets and boundaries

M2 adds owner-scoped reminder records and preferences with the same session/CSRF
boundary. Composite foreign keys protect linked tasks/projects. Database leases,
dispatch transactions, immutable occurrence idempotency keys and fenced completion
prevent concurrent mock effects. Uncertain outcomes reconcile; bounded retry exhaustion
remains visible. Mock receipts store only keys/IDs. Provider exceptions and invalid
responses map to unknown, without persisting raw payloads. Only the mock adapter is
available; no M2 endpoint can request real delivery. M3 must assess real-provider
idempotency, reconcile semantics, consent and fallback before any live integration.
The runtime still uses the local database owner; least-privilege roles and restore
security remain deployment/M6 gates. See m2-results.md for actual test evidence.

Future assets include private memories, obligations, approval records and provider
credentials. Current boundaries are local HTTP to API, API/worker to PostgreSQL,
environment to configuration and code dependencies to build execution.

## M0 controls

- API listens on 127.0.0.1. All /api routes deny access until identity is implemented.
- Only health endpoints are available. No model tools, messaging or action adapters.
- Readiness checks migrated schema, not just process life; failure returns 503.
- Request IDs are generated server-side. Logs contain event, status and timing,
  never request URL, body, headers, database URL or raw exceptions.
- Configuration errors omit input values. Environment template contains names only.
- Local state and credentials are ignored; dependencies are pinned in a lockfile.
- PostgreSQL uses bounded connection/query timeouts. Worker does not depend on AI.
- Integration test rejects nonlocal URLs and databases without axis_test_ prefix;
  it requires an empty database and never drops existing data.

## Risks and later controls

Loopback binding does not replace auth against hostile local programs. Do not expose
M0 through a proxy or public port. M1 must implement maintained auth, owner scoping,
CSRF/session security, rate limits and input limits before accepting private data.
Dependency audit is point-in-time evidence, not a guarantee. Pino redaction is defense
in depth; only allow-listed metadata may be passed to logging calls.

Future imported content/model output is untrusted. Backend authorization must protect
every action regardless of instructions in it. M2 tests durable mock claims, retries
and reconciliation; M4 still requires immutable payload approval, 24-hour request expiry,
single consumption and high-risk re-authentication. No current test proves those
future capabilities. Backups, encryption and restore exercises are not implemented.

If exposure is suspected: stop local processes, disable integration access where
authorized, rotate affected secrets, preserve redacted evidence and inform owner.

# M1.5 additions

AI provider keys use authenticated encryption in a dedicated owner-scoped table. Master keys live only in server configuration, with versioned backup/rotation. API metadata and logs exclude keys/ciphertext. The fixed Groq destination and redirect rejection prevent custom-endpoint SSRF. Existing sessions, owner identity, CSRF, body limits and SQL ownership remain authoritative. Per-user database rate windows and bounded input/output constrain cost; unknown provider outcomes prohibit blind retries.

Retrieved memory, tasks, projects and provider replies are untrusted content. No tool executor or external action permissions exist in M1.5; output is escaped text. Prompt instructions alone cannot guarantee model truthfulness. Sensitive memories are excluded, and context sharing is opt-in. Production HTTPS, database least privilege, backup protection, live provider acceptance, and future multi-user onboarding still require review. See the M1.5 specification and results for limits and test evidence.
