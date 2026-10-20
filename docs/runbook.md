# Local AXIS runbook

**M6 current override:** Schema **12**. Use the new
[disaster-recovery runbook](runbooks/disaster-recovery.md) for encrypted backups,
restore checks, quarantine and operator scheduling. Older operational/schema notes
below are historical. Read-only Calendar setup is in `15-m6-calendar-backups-recovery.md`.

Current schema: **6**, including Telegram migration 006. Stop API/worker before
upgrade, then use `npm run dev` and `npm run dev:worker`. Current notification
instructions: [Telegram setup](telegram-setup.md). Older WhatsApp and schema-4
notes below are historical; active WhatsApp dispatch is disabled. Telegram-only
mode needs no public URL; Resend email remains optional with separate setup.

Prerequisites: Node 24, npm 11, PostgreSQL 18. No Docker required. Google
sign-in needs an owner-configured OAuth client; see google-sign-in.md.
The Windows npm launchers use built-in Windows PowerShell; no PowerShell 7 install is required.
Run commands from repository root. Dependencies: `npm ci`.

## M3 notification delivery

Default mode remains simulation. Run `npm run dev` and, separately,
`npm run dev:worker`. See [M3 configuration, consent and recovery](11-m3-messaging-notifications.md)
for Twilio Sandbox, Resend and signed callback setup. Both processes need the same
mode and server-only configuration. No model credentials are required by the worker.
Migration 005 adds explicit email verification evidence; sign out/in before enabling
email. Never reset an uncertain delivery to queued: inspect history and use the
bounded provider-status check when a reference is available. Live provider tests
require consenting recipients and remain pending until documented as executed.

## M1 quick start

Multi-user update: any verified Google account can enroll. OWNER_EMAIL is ignored; existing Google client/session/database settings remain valid. Restart with `npm run dev`, then sign in from separate browser profiles to test private workspaces. No schema migration is needed for this authentication change. Each user supplies their own AI key in AI Settings. Google audience restrictions may still limit who can complete consent.

After creating the Google client, run `npm run setup:google` to save its credentials
privately. Then run `npm run dev`. This starts the existing local database if needed,
runs migrations, builds the dashboard and starts the API. Open **http://localhost:3000**.
With no auth configuration, the setup page is available but private APIs are denied.
The launcher leaves PostgreSQL running when the API exits, so the independent
reminder worker can continue. Stop both processes before using the explicit database
stop command below. Override PG_BIN if your local PostgreSQL binary path differs.

Run `./scripts/verify-local.ps1` for isolated integration and database restart checks.
Run `./scripts/verify-local.ps1 -Browser` after `npm run build` for the Edge browser
workflow using synthetic data and a test-only identity provider. Each creates and
retains a separate empty test database; neither erases a database. Windows loopback
tests may require execution outside restricted process/network sandboxes.

This workspace already has an isolated cluster at `.local/pgdata` and a privately
configured `.env` for axis_dev on port 55432. It is stopped after verification.
Start that cluster with pg_ctl below; do not run initdb again on it.

## Database and startup

The Windows launcher starts PostgreSQL only when `pg_ctl status` reports it
stopped, then waits up to five minutes for readiness. It also waits for an existing
server that is recovering after an interrupted shutdown. Progress messages appear
every 15 seconds. The old default 60-second startup wait could expire during normal
crash recovery.

If startup still times out, inspect `.local/postgres.log` for recovery progress.
Do not launch another PostgreSQL instance, remove `postmaster.pid`, or reinitialize
the cluster. Once recovery finishes, run `npm run dev` again. The database-only
check/start command is `powershell.exe -NoProfile -File scripts/start-local-postgres.ps1`.
On 2026-10-20, the existing cluster completed recovery in about 100 seconds and
accepted connections; the updated launcher was verified against that running cluster.

Use an isolated local cluster bound to 127.0.0.1 on a spare port (M0 validation uses
55432). PostgreSQL binaries on this machine are in
`C:/Program Files/PostgreSQL/18/bin`. Use `initdb -D .local/pgdata -U axis_local
--auth=scram-sha-256 --encoding=UTF8 --pwfile=<local-password-file>`, then `pg_ctl -D .local/pgdata
-l .local/postgres.log -o "-h 127.0.0.1 -p 55432" start`.
Generate a local password; never paste it into chat, commit it or reuse a real secret.
Do not reinitialize an existing data directory. Create a new development database
using `createdb -h 127.0.0.1 -p 55432 -U axis_local axis_dev`.

Create ignored `.env` from `.env.example`. Set DATABASE_URL to the local PostgreSQL
connection URL with the generated credentials and database name. Blank optional
PORT and LOG_LEVEL entries use defaults (3000 and info), or set valid values.
Do not put DATABASE_URL in frontend VITE_ variables.

Run `npm run db:migrate`, then `npm run dev:api`. In a separate terminal run
`npm run dev:worker` for M2 reminders. Delivery is mock-only: no messages leave AXIS.
`npm run worker:health` exits zero if a worker heartbeat is fresh (90 seconds) and
the schema is ready, or nonzero otherwise. See [M2 operations](m2-operations.md).
GET `http://127.0.0.1:3000/health/live` returns alive; `/health/ready` returns ready
only after the current schema exists. `/api/v1/*` returns UNAUTHENTICATED unless
Google auth is configured and a valid owner session exists.

Stop each process with Ctrl+C. Stop the isolated cluster with
`pg_ctl -D .local/pgdata -m fast stop`. Never delete its data directory as routine cleanup.
An unhealthy readiness response requires checking the local DB process, credentials
and migration command. Do not print connection strings when investigating failures.

## Verification

- `npm ci` verifies lockfile installation.
- `npm run check` runs format, lint, types and unit/security tests.
- Create a fresh empty `axis_test_<unique_suffix>` local database. Set
  TEST_DATABASE_URL privately and run `npm run test:integration`. Missing config or
  reused/nonempty database fails rather than skipping. No automatic database deletion.
- `npm audit --audit-level=high` checks dependency advisories.
- Inspect tracked file candidates before any commit; `.gitignore` is not a scanner.
- CI definition runs the same checks against a disposable PostgreSQL service.

## Operational limits

No Git remote, deployment, backup automation, reminder scheduling, approval executor
or messaging integration is configured. Real Google sign-in still needs owner setup
and manual verification. Review that gate before storing personal records. M6 must prove
isolated restore and measure RPO/RTO; no recovery guarantees are claimed now.

# M1.5 AI operations

Run `npm run setup:ai`, preserve the generated ignored `.env` in secure backup, and restart the API. Configure personal provider keys only in AI Settings. Never paste them into chat or logs. AI is disabled without the master key; tasks and reminders continue. Full configuration, endpoint contracts, safe key rotation (`npm run ai:rotate-keys`), and manual live acceptance are in [M1.5](10-m1-5-ai-provider-foundation.md).

After migration 004, all processes expect schema version 4. Stop API/worker for migration, run `npm run db:migrate`, and restart them; the normal local launcher migrates automatically. Keep database and keyring backups paired. On recovery, pending AI calls older than two minutes become unknown on history/status access and are never automatically reissued.
