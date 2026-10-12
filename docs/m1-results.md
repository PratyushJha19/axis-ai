# M1 verification results

## Occupied-port startup fix — 2026-10-11

An earlier AXIS process still owned loopback port 3000. It was stopped and the
port was verified free. Express calls its listen callback on errors too; startup
now logs success only on the listening event. Bind failures report a safe port
conflict hint and close database/auth resources without logging raw errors.
`npm test` passed six tests, including a new regression that occupies a local
port and checks exit code 1, the conflict hint, and absence of false success or
synthetic credentials in output. No real Google login was performed.

## Windows launcher compatibility fix — 2026-10-11

The owner's terminal could not resolve `pwsh`. Both npm launchers now use built-in
`powershell.exe`. Google setup uses .NET Framework-compatible cryptographic random
generation and explicit UTF-8 without BOM when saving configuration. No architecture
or authentication policy changed. An isolated dummy-input probe run with Windows
PowerShell 5.1 passed: database configuration preserved, owner email normalized,
96-character hexadecimal session secret generated, and output had no BOM. The real
`.env` was not modified. Real Google acceptance remains pending; the full development
launcher was not restarted as part of this fix.

`npm run check` passed formatting, lint and type checks; its security test hit the
sandbox's loopback `EACCES` restriction. `npm test` rerun with local network access
passed all five tests. Database integration and browser suites were not rerun for
this launcher-only fix.

Date: 2026-10-10. Status: local implementation and automated checks passed. Real
Google OAuth setup/manual acceptance is still pending. Full MVP is not complete.

## Delivered

Google owner sign-in integration, revocable PostgreSQL sessions, strict owner-scoped
projects/tasks/memory APIs, idempotent creation, versioned edits, memory full-text
search, privacy consent, hard deletion, content-free audit, task status history,
profile/timezone setup and a responsive React dashboard. The local launcher now
starts PostgreSQL, runs migrations, builds the web app and serves it at localhost:3000.

Architecture choices are recorded in ADR-013 and ADR-014. API details are in
m1-api.md; setup in google-sign-in.md and runbook.md. No existing user work or
specification exports were removed. No Git repository or remote exists here.

## Commands actually run

| Command                                          | Result                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| npm install --package-lock-only --ignore-scripts | Updated workspace lockfile successfully                                                          |
| npm ci                                           | Clean installation passed; 284 packages audited                                                  |
| npm run format / npm run format:check            | Passed                                                                                           |
| npm run lint                                     | Passed                                                                                           |
| npm run typecheck                                | Backend/shared/tests and frontend passed                                                         |
| npm test                                         | 5/5 unit/security tests passed                                                                   |
| npm run build                                    | Vite build passed; approximately 254 kB JS / 79 kB gzip                                          |
| npm audit --audit-level=high                     | Zero reported vulnerabilities                                                                    |
| ./scripts/verify-local.ps1                       | Real PostgreSQL integration scenario passed; cluster restart persistence passed                  |
| ./scripts/verify-local.ps1 -Browser              | Edge workflow passed: 1 test, final run 7.6 seconds                                              |
| npm run dev                                      | Existing M0 development DB upgraded with one migration; frontend built; API started on port 3000 |

An in-process source/docs/built-assets scan compared configured secret values without
printing them and found no matches outside ignored local configuration. This is not
a claim to detect every possible unknown secret. No credentials were committed.
The npm esbuild installation-script warning remains informational on this platform;
the actual clean install and build both passed. CI definition includes checks and
build, but has not run remotely. Browser verification was local, not remote CI.

## Acceptance evidence

- Migration from an empty isolated DB runs 001 and 002; repeat migration is a no-op.
- Existing M0 axis_dev migration applied 002 successfully through normal startup.
- Database restart preserves the saved completed task. A new app instance accepts
  the database-backed session; refresh preserves the displayed record.
- Auth tests reject unsigned cookies, wrong/unverified Google identity, incorrect
  OAuth state, replayed callback, changed owner subject and expired sessions.
- Logout revokes access. Cookie HTTP-only/SameSite flags and CSRF/exact-Origin checks
  pass. Authentication is tested with a controlled provider, not Google's live service.
- API and service tests reject cross-owner reads, edits, deletes and project links;
  composite DB foreign keys also reject cross-owner links.
- Concurrent identical creation returns one entity; payload changes with a reused
  key and stale edits return conflicts. Task history records transitions.
- Sensitive memory without consent and credential-shaped memory fail. Corrections
  update search; archive filters work; hard deletion removes content and search hits.
- DB audit mutation is denied. Logs omit synthetic private request content.
- Browser workflow creates a project and tasks, completes/edits tasks, saves ordinary
  and sensitive memory, requires consent, archives, deletes, updates timezone and
  reloads persisted state. Mobile width has no horizontal overflow. Dialog initial
  focus and Escape closure pass; no JavaScript page errors occurred.
- Desktop (1440 px) and mobile (390 px) screenshots were inspected. They contain
  synthetic test records only, saved under ignored .local/dashboard-*.png.

## Failures found and resolved

The first type check exposed a test helper typed too broadly; it was narrowed.
Lint identified an unused icon import; it was removed. Two browser runs failed on
exact-label selectors for dropdowns; role/name selectors fixed those test locators.
The next run exposed a real editor focus issue: autofocus happened before the modal
opened. Focus is now explicitly set after showModal and restored on close. Mobile
review also corrected a missing text space and kept task priority/due dates visible.
Final tests include these fixes. Earlier failures are not counted as successful runs.

## Remaining gates and risks

The owner must create/configure the Google OAuth Web client and manually verify real
consent/login/wrong-account/logout flows. The private setup helper is provided but
was not run with real credentials. No real Google sign-in was attempted. Production
TLS, proxy trust, least-privilege DB roles and hosting are not configured. The local
development HTTP exception is not production security approval.

Automated memory sensitivity/credential checks are conservative heuristics. Project
pickers are limited to 100 and task view filters apply to the current page (labelled).
Recurrence, dependencies, reminders, model-assisted capture, notifications, approval
execution, daily planning, calendar integration and backup/restore release gates
remain later milestones. Keyboard basics were tested; a full accessibility audit
and broader browser coverage remain manual work.

Google sign-in choice resolves the M1 identity-provider decision. Notification
approval exceptions, quiet hours, retry/fallback timing, high-risk policy and hosting
remain unresolved for later milestones. Stop here before M2 scope is undertaken.

## Current local state

The normal development app was started successfully with npm run dev and left running
for inspection at http://localhost:3000. It shows Google setup guidance until the
owner configures credentials and the API is restarted. axis_dev contains no seeded
personal records. Synthetic test databases were retained separately for inspection;
test browser/server processes were stopped. The independent worker is not needed for
M1 and is not running. No paid services, deployment, live messages, calendar writes,
model calls or other consequential external actions occurred. Public documentation,
package downloads and package vulnerability auditing were the external network uses.
