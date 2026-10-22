# Initial threat model

## Telegram command boundary (2026-10-21)

Webhook ingress requires a constant-time checked secret, bounded JSON, schema
readiness and recovery release. Only private non-bot senders whose ID matches the
chat and a verified bot-specific AXIS link are accepted. Forwarded commands are
ignored. The owner is never accepted from message text. The inbox is durable and
deduplicated by bot/update identity; owner locks fence link changes and dispatch.
Commands bind to the link revision, and replies recheck it before dispatch.

The model receives only a direct natural-language creation request and timezone;
it cannot approve or execute. Explicit ID-based confirmation reuses M4's immutable
payload, 24-hour expiry and transactional execution. Narrow internal edits bind
the target version; deletion and external/high-risk operations remain denied.
Webhook secret compromise could impersonate linked senders: keep it separate from
the bot token, rotate both at their source if exposed, and never log headers or
provider URLs. Telegram account compromise grants this limited linked authority;
disconnect in the signed-in dashboard to revoke it.

Reply dispatch has a durable sending state. Timeout/crash becomes unknown without
blind resending. A committed action may succeed even if its reply is unknown;
inspect the approval ledger before issuing a fresh mutation. Per-user rate limits,
short input retention, seven-day reply cleanup and no group support limit exposure.
Free-host sleep and Telegram cold-start retries delay work; they do not grant
approval or ensure scheduled reminder punctuality.

## M6 Calendar and recovery (2026-10-20)

Calendar consent is independent from sign-in, with single-use ten-minute database
state bound to the initiating user/session plus PKCE/nonce and same Google subject.
Credentials use owner/purpose/version authenticated encryption. No client token,
arbitrary endpoint, Calendar write method or model Calendar-text context is exposed.
Cached text is untrusted and rendered as text. Refresh leases and connection revisions
prevent a delayed result restoring disconnected data. Local disconnection commits
before best-effort remote revocation; an already-started request cannot be recalled.

Whole-database backups contain personal data and application-encrypted credentials.
AES-GCM, authenticated metadata/checksums, private OS ACLs and separate operator keys
protect artifacts; there is no ordinary-user backup endpoint. Restore checks use
fresh local databases only. Cutover copies remain quarantined, with sessions cleared.
Database snapshots cannot undo messages or reconstruct post-snapshot completion;
quarantine requires operator reconciliation, never automatic replay. Independent
storage, durable schedules, remote alerts, live consent and deployed RPO/RTO remain
unverified operational gates. Filesystem administrators remain trusted operators.

## Telegram replacement (2026-10-15)

Only authenticated users can request hashed, single-use linking challenges and
enable their verified private chat. Poll responses come from the fixed HTTPS Bot
API, under a durable bot lease; cursor and account changes commit atomically.
Private human sender/chat IDs must match. Bot ID scopes proof and queued consent.
General messages and groups cannot invoke AI/tools/actions. No Telegram inbound
HTTP route is exposed. Token-bearing provider URLs and raw errors are never logged.
Paid broadcasts are disabled. Unknown sends remain uncertain without blind retry;
sent is not delivered/read. Poll failures do not stop the scheduler. A long outage
can lose Telegram updates after 24 hours; dashboard disconnect is durable local
revocation. Linking does not send a reply or enable notifications automatically.

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

# M3 notification boundaries

Notification settings and history are scoped by the authenticated session. Sending
uses a saved destination and consent revision, rechecked under the owner's database
lock at dispatch. WhatsApp binding uses a 192-bit single-use code, ten-minute expiry,
exact E.164 sender and an authenticated Twilio inbound callback. Phone proof alone
does not enable delivery. STOP invalidates consent/proof. Email comes only from a
verified Google login and must be explicitly enabled. Old accounts are not silently
marked verified. Arbitrary recipients, user IDs and reminder IDs are rejected in
the fixed test endpoint. Durable per-user/provider limits constrain sending.

Callbacks validate account/message/destination binding. Twilio uses its official
validator with the configured external HTTPS URL and all form parameters. Resend
uses Svix validation over raw bytes, then parses JSON only after verification.
Replay IDs and monotonic confirmed states protect delivery history. Bounded body
sizes, route rate limits and content-free HTTP logging apply. No raw callback,
signature, message body or credential enters logs. Provider HTTP endpoints are fixed;
redirects are rejected. HTML email escapes user text. No model is involved.

Crashes and transport failures are unknown, not permission to resend. Fenced leases
and occurrence/channel uniqueness guard concurrent workers. Email fallback after
an unknown primary may still yield two messages; the UI discloses this. Disabling a
channel cannot recall an already submitted request. Public hosting, production
sender approval, provider account compromise and backup/restore remain separate
operational gates. M3's personal-notification consent does not implement or bypass
the future approval executor.

# Free demo hosting boundary — 2026-10-20

2026-10-21 override: FREE_HOST_NOTIFICATIONS may explicitly enable the existing
reminder worker and live notification configuration on the free host. API and
worker remain separate processes but share host availability/memory. Existing
per-user channel consent, poll leases, dispatch fences and unknown states remain
authoritative. Host suspension can cause late notifications and expired linking
codes; it must never be presented as reliable scheduled delivery. The supervisor
stops its sibling if either child exits. No keep-alive or agent worker is added.
This overrides the default worker prohibition below only when enabled.

The optional Vercel/Render demo uses a new database and mock notifications.
Vercel proxies auth/API requests under one browser origin; credentials stay on
Render. Host binding and one-hop proxy trust require explicit configuration and
default to loopback/no trust. Enable proxy trust only behind Render ingress that
sets forwarding headers. Live checks must verify secure cookies, original Origin
preservation, no caching and Google callback routing before sharing the demo.
DEMO_MODE rejects delegated execution and worker startup; it cannot provide timely
reminder delivery, retention cleanup or scheduled backups. Provider free quotas and
sleep behavior are availability risks. See `render-vercel-demo.md`.
