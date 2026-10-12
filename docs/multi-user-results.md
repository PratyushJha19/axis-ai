# Multi-user milestone — results

Date: 2026-10-12. Implemented and verified with synthetic Google identities and real application sessions. Live two-account Google acceptance remains pending.

## Behavior

The owner explicitly selected signup for anyone with a verified Google account. First sign-in creates a private workspace; subsequent sign-ins use the same immutable Google subject. Different subjects never share an account, even with identical email metadata. Email changes preserve the same user ID and user-edited profile/timezone. Concurrent first sign-ins create one row using the existing unique subject constraint.

Existing accounts, user IDs, records, encrypted BYOK keys and valid sessions are preserved. `OWNER_EMAIL` is obsolete and ignored. The historical `owner_binding` table remains untouched but has no authorization role. No migration was necessary; schema stays at version 4.

All private routes continue deriving identity from server-validated sessions. Projects, tasks, memories, reminders, preferences, AI configuration and conversations remain per-user. There is no cross-user sharing, user directory, admin access to private records or central provider key. Existing OIDC verification, PKCE/state/nonce, session regeneration/expiry, Origin/CSRF checks and rate limits remain active.

## Changed files

- `services/api/src/auth.ts`: verified Google enrollment, atomic subject-based account reuse, session authorization without the singleton owner gate, bounded identity claim validation.
- `scripts/configure-google.ps1`, `.env.example`: no owner-email requirement. Existing `.env` was not overwritten.
- `apps/web/src/App.tsx`: multi-user sign-in and setup wording. `styles.css`: scrollable sidebar so account controls are reachable on short screens.
- New `tests/integration/multi-user-scenarios.ts`, `tests/e2e/multi-user.spec.ts`; updated `tests/integration/core-scenarios.ts`, `database.test.ts`, `tests/e2e/server.ts`, `tests/unit/contracts.test.ts`.
- Documentation: `multi-user-plan.md`, this report, README, Google setup, master context, security specification, roadmap, ADR-017, M1.5 specification supersession note, runbook and threat model.

## Actual checks

| Command                                         | Result                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run check`                                 | Passed: formatting, ESLint, TypeScript and 21 unit/security tests                                            |
| `npm run build`                                 | Passed; frontend rebuilt after the sidebar fix                                                               |
| `./scripts/verify-local.ps1`                    | Passed: 36 PostgreSQL tests, including five new multi-user scenarios and existing M1/M1.5/M2 regressions     |
| PostgreSQL stop/start persistence check         | Passed: core records, reminders/attempts/receipts, encrypted AI settings, chat and unknown requests survived |
| `./scripts/verify-local.ps1 -Browser`           | Passed: 5 Edge browser tests, including two isolated browser contexts and independent logout                 |
| `npm audit --audit-level=high`                  | Passed: 0 vulnerabilities                                                                                    |
| Final `npm run format:check` and `npm run lint` | Passed after the final test/CSS changes                                                                      |

Integration database: `axis_test_50ad0b4b9050`. Final browser database: `axis_test_e2e_b47d7d6b5687`. Isolated synthetic databases retained for inspection; scripts stopped the PostgreSQL cluster they started.

New tests cover concurrent enrollment, two real cookie sessions, different subjects sharing an email, changed email for the same subject, legacy owner ID preservation, independent timezones, CSRF token separation, cross-user read/edit/delete/link denial, per-user idempotency, reminder preferences/attempt privacy, separate actual adapter key selection, conversation/request denial, and logout isolation. Existing session replay/expiry, encrypted credentials and reminder crash/recovery tests passed.

Two browser failures were resolved: redirect interception initially failed to select the second synthetic provider identity; the fixture now uses the real session-bound OAuth start endpoint and the synthetic account-selection code before completing the callback. The next run exposed a real short-screen sidebar overflow hiding Sign out; adding vertical scrolling made the control reachable. Final browser tests passed without forced clicks. No remaining automated failures.

## Run and manual acceptance

Stop an existing API process, then run `npm run dev`; run `npm run dev:worker` separately for reminders. Existing Google client and session settings work unchanged; do not rerun setup merely to remove OWNER_EMAIL. New installations use `npm run setup:google` and `npm run setup:ai` as documented.

1. Open http://localhost:3000 and sign in with Google account A.
2. Create a harmless task and optionally configure A's own Groq key through AI Settings.
3. Open a separate browser profile or private window and sign in as Google account B. Google OAuth audience configuration must permit both accounts.
4. Confirm B gets a different private workspace and cannot see A's task, memories, reminders, conversations or key configuration. B supplies its own Groq key independently.
5. Create B's own task; reload both profiles and confirm separation persists.
6. Sign B out and confirm A remains signed in. Re-sign B in and confirm B's records persist.

Actual Google consent and personal-key Groq calls were not performed. The tests substitute identity/provider responses only in test harnesses; production has no identity bypass. Google audience policies can still restrict which accounts complete consent independently of AXIS's open-enrollment policy. See [Google OIDC documentation](https://developers.google.com/identity/openid-connect/openid-connect) and `google-sign-in.md`.

No deployment, paid provisioning, real notifications, team sharing, billing or M3/M4 implementation was performed. The API still listens on loopback. Public hosting, operational capacity/abuse controls, account suspension/deletion and production-wide quotas remain separate scope; this is not a production SaaS launch claim.
