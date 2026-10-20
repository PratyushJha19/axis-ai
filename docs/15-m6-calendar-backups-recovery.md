# M6 — Calendar, backups and recovery

## Audit and implementation plan — 2026-10-19

Baseline: migrations 001–011, Express sessions and Google identity-only login,
owner-scoped PostgreSQL records, AES-GCM BYOK vault, independent reminder and agent
workers, deterministic M5 planning. No Calendar tokens, backup scripts, deployed
host, protected remote storage or operational scheduler exist. Existing CI uses
disposable PostgreSQL. Historical runbook schema/operational notes are outdated.

Implement only M6. Acceptance requires separate state/PKCE/session-bound Calendar
consent; encrypted credentials; refresh/disconnect and isolation tests; bounded
read-only events and deterministic planning conflicts; encrypted consistent dumps,
checksums/manifests and safe retention; actual isolated restore evidence; regression
checks and an operator recovery runbook. Live Google acceptance and configured
off-machine storage/scheduling must be reported separately from mocked tests.

## Design

- Reuse the Google OAuth client, but use a separate callback and explicit consent.
  Require the same verified Google subject as the signed-in AXIS account. Request
  `openid email https://www.googleapis.com/auth/calendar.events.readonly` only.
  Primary calendar only in this milestone; additional calendars need later UI.
- Reuse the versioned AES-GCM vault with a distinct Calendar purpose and owner AAD.
  Store refresh tokens only; short-lived access tokens remain in process memory.
  Missing key disables connection operations. Sign-in scopes remain unchanged.
- Explicit bounded refresh, no background polling. Replace a complete cache only
  after every page succeeds; retain last-known busy intervals on temporary failure.
  Five-minute freshness, maximum 31-day requested range, 10 pages/2,500 events.
  Store minimal titles/times/transparency, no descriptions/attendees/locations.
  Disconnect deletes credentials/cache and invalidates pending connect flows.
- Existing M5 scheduler consumes cached busy intervals without provider calls in
  database transactions. Disclose stale/missing coverage; Calendar failures must
  not stop tasks or reminders. Calendar text is never sent to AI or stored as memory.
- Operator-only PostgreSQL custom dumps, streaming authenticated encryption,
  private filesystem storage outside served directories, atomic manifests and
  checksums. Separate backup key and recovery copies of application keyrings.
  Retain seven distinct daily points and one monthly point after verified success.
- Restore checks create uniquely named disposable local databases only. Never
  overwrite an existing database. No backup API or invented administrator role.
  External effects after the snapshot cannot be reversed: recovered systems must
  start quarantined until notification/action reconciliation is reviewed.

## Operational dependencies and targets

This workspace is a local Windows machine with PostgreSQL 18, not an always-on
production host. Supply durable scheduler templates/manual commands, but do not
install tasks, provision storage or claim active monthly automation. An operator
must select private off-machine storage and an always-on scheduler before the
24-hour RPO is credible. Four-hour RTO requires a measured deployment recovery
drill, separately protected keys and authorized reconciliation. These deployment
choices remain open and do not block local implementation/testing.

## Provider references

[Google event reads](https://developers.google.com/calendar/api/v3/reference/events/list)
and [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
define the read scope, bounded expanded recurrence reads and offline refresh flow.

## Implemented API and user experience

All routes use the existing authenticated owner session. POST requests require
exact Origin and CSRF; bodies reject additional authority/owner fields.

| Route under `/api/v1`       | Contract                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| GET `/calendar/status`      | Safe connection state, cache/freshness and commitments; no token                 |
| POST `/calendar/connect`    | `{consent:true}` returns the Google consent URL                                  |
| GET `/calendar/callback`    | Consumes state once; verifies session, PKCE/nonce, scope and same Google subject |
| POST `/calendar/sync`       | `{date:"YYYY-MM-DD",days:1..31}` in the owner's profile timezone                 |
| GET `/calendar/events`      | Same date/days query; cached events and warning                                  |
| POST `/calendar/disconnect` | `{confirmed:true}`; local deletion and remote-revocation result                  |

The Planning page returns directly after Calendar consent. Primary-calendar
commitments are displayed separately from AXIS tasks and plans. The UI refreshes
14 days beginning at the chosen date/week start. Other date ranges use the bounded
API. No automatic API polling or background Google sync is introduced. Refresh
has a 120-second lease, 30-second success cooldown and five-minute failure cooldown;
each provider request has a ten-second timeout, at most ten event pages. Revoked
or insufficient access requires reconnect. Google recurrence expansion is used.
Cancelled events are excluded; busy all-day/cross-midnight events block time;
transparent events are displayed but do not block. Event descriptions never enter
the cache. Existing cache lasts until a successful replacement or disconnect and
becomes stale after five minutes. This is not an offline freshness guarantee.

Plan generation/edit/acceptance checks currently cached busy periods under the
same owner lock used to publish refreshed data. Missing/stale/out-of-range data
adds explicit warnings and leaves task-only planning available. It does not claim
a conflict-free live calendar when Google is unavailable. Existing accepted plans
are not silently rewritten when a remote event changes. Regenerate/review plans
after refresh. Additional calendars and push/incremental sync remain future scope.

## Backup implementation and configuration

Commands: `npm run backup`, `backup:verify`, `backup:restore-check`, `backup:health`,
`backup:restore-new` and `recovery:quarantine`. See the
[recovery runbook](runbooks/disaster-recovery.md) for confirmation arguments and
operational instructions. No backup is accessible through an application route.

Required operator settings: BACKUP_DIRECTORY, BACKUP_ENCRYPTION_KEY,
BACKUP_KEY_VERSION (default v1), existing DATABASE_URL and optional PG_BIN. Calendar
reuses Google client/origin and AI_CREDENTIALS_* keyring settings. No user Groq key
is needed for Calendar. Every dump covers all application tables and data, sequences,
indexes and constraints. Counts are captured from the same exported snapshot as
pg_dump. A schema-object fingerprint, archive readability, checksum and authenticated
decryption are verified; restore checks also compare rows and credential recovery.
No plaintext dump is written to disk. Only completed verified artifacts get final
manifests; interrupted partial artifacts remain private for operator review.

Restore-check deletes only its newly created disposable DB. Explicit restore-new
preserves only a new UUID-named local recovery DB, quarantines it and clears restored
sessions/OAuth challenges. Source database records are not modified. Release of
quarantine is a reviewed operator operation, not a normal-user button. Ordinary
crash recovery is not sufficient to reconcile post-snapshot external side effects.

Windows scheduler installation is supplied but not executed. CI uses PostgreSQL 18
clients in its existing service container; the changed CI workflow has not been run
on a remote runner. Local verification uses actual PostgreSQL 18 tools. Operational
details, test evidence and remaining acceptance gates are in `m6-results.md`.
