# M0 verification results

Date: 2026-10-10. Status: local foundation implemented and technical checks passed.
M1 has not started. Outstanding owner decisions prevent full M0 decision sign-off.

## Changes

Added npm workspace tooling and lockfile; API liveness/readiness; generated request
IDs and metadata-only logs; fail-closed product routes; separate worker skeleton;
Kysely/PostgreSQL foundation migration; blank environment template; CI definition;
unit, privacy/security and real-database tests; threat model and runbook.
Added ADR-011/012 and updated README. Original specification exports are preserved.

## Executed commands and evidence

- Repository inventory with `rg --files` and `git status --short`: documentation
  only; Git reported no repository. No commits or remote CI runs occurred.
- `node --version`, `npm --version`: 24.18.0 and 11.16.0.
- `docker version`: client installed, engine unavailable. Owner chose local PostgreSQL.
- Registry access initially failed with sandbox ENOTFOUND; approved installation
  outside sandbox succeeded. ESLint 9's deprecation warning prompted upgrade to 10.
- `npm ci`: clean lockfile installation succeeded; 238 packages audited, zero
  vulnerabilities. npm reports the esbuild install script is not explicitly allowed;
  current platform tooling nevertheless ran successfully. Review this warning if a
  different platform requires the optional installation fallback.
- `npm run check`: final rerun passed formatting, lint, TypeScript and 3/3 tests.
  An initial test type error was corrected. The final run includes a regression
  check for blank optional values copied from the environment template.
- Local `initdb` and `pg_ctl`: isolated `.local/pgdata` cluster on loopback port 55432. Database creation uses template0 and UTF8; initial Windows cluster default
  encoding was WIN1252, so UTF8 was selected explicitly for application/test DBs.
- `node --env-file=.local/test.env --import tsx database/scripts/migrate.ts`:
  succeeded, one migration applied to axis_dev.
- `node --env-file=.local/test.env --import tsx --test tests/integration/*.test.ts`:
  1/1 passed against empty axis_test_m0. Proved missing-schema readiness=503,
  migration and repeat no-op, readiness=200, constraint enforcement, UTC connection
  timezone and persistence across connection teardown/reconnect.
- Initial local network tests failed under sandbox EACCES. The sandbox-started
  database then became unreachable (ECONNREFUSED). Starting/testing/stopping the
  isolated cluster outside sandbox succeeded. These failed attempts are not passes.
- `npm audit --audit-level=high`: zero vulnerabilities.
- `node --env-file=.local/test.env --import tsx scripts/smoke.ts`: passed real API
  startup, live/ready HTTP and independent worker database readiness. Child
  processes were stopped; the isolated PostgreSQL cluster was then stopped cleanly.
- Targeted `rg -l` scan of nonlocal source/config/docs for private-key headers,
  AWS access-key IDs and long sk-prefixed keys: no matches (rg exit 1). This is a
  limited pattern scan plus source review, not proof against every secret format.

## Acceptance status

Clean install, format/lint/types, 3 unit/security tests, empty-database migration,
health behavior and API/worker startup all have passing evidence. No real credentials
were added to source; generated local DB credentials are confined to ignored `.env`
and `.local` configuration. No Git repository exists, so there is
no committed-history scan to claim. CI is authored but not remotely executed.

## Decisions and limits

See m0-plan.md for notification authorization conflict, M3/M4 ordering, fallback
timer ambiguity and unresolved policy. Auth provider/library and session/enrollment
policy require confirmation before M1. Hosting/model choices stay open with no
accounts or calls enabled. Full approval/reminder/auth features are not implemented
or claimed tested. Recovery backups and restore tests remain later milestone work.

No deployment, paid infrastructure, real messaging, real calendar access, or model
calls occurred. External network use was limited to public technical documentation,
dependency downloads and vulnerability auditing. Local database contains foundation
metadata only. Do not proceed to M1 until its identity decision and scope are settled.

## Local handoff

The initialized cluster is preserved at `.local/pgdata`, currently stopped. The
development database is axis_dev on port 55432; `.env` is configured privately for
it. Start PostgreSQL as described in the runbook, then use `npm run dev:api` and
`npm run dev:worker`. The already-used axis_test_m0 database is retained; create a
new empty test database for any integration rerun. No user database was modified.
Windows process termination was exercised by the smoke script; graceful POSIX
signal handling and remote CI have not been exercised on this machine.
