# M1.5 implementation and verification

Date: 2026-10-12. Status: implementation and automated checks passed. **Live Groq acceptance remains pending; M1.5 is not fully complete.** No personal provider key was used, no paid inference was performed, and no deployment or real notification was sent.

## Delivered

- Real non-streaming Groq HTTPS adapter with fixed endpoint, Bearer authentication, explicit model registry, bounded response parsing, normalized usage/errors, timeout and no automatic retry/fallback. Models: `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`. NVIDIA is pending and absent from the UI.
- AI Settings within the dashboard: select model, enter/test/save/replace/delete key, test saved connection, clear key input after saving, safe metadata and explicit test-call consent.
- Persistent Chat within the dashboard: new/continued conversations, escaped text, bounded history, optional read-only PostgreSQL context, loading/error states, explicit bounded failure retry and read-only status recovery. Unknown outcomes are never blindly resent.
- Owner-scoped APIs and relational constraints, existing Google sessions/Origin/CSRF protection, credential encryption with AES-256-GCM and owner/provider/version binding, content-free logs/audit, persisted user rate limits, setup and transactional rotation CLI.
- M1/M2 behavior preserved. Worker does not import or require AI configuration. Missing master key disables AI only; malformed supplied AI environment settings fail API startup with a safe diagnostic.

## Files changed

| Area          | Files                                                                                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI domain     | New `packages/domain/src/ai.ts`, `ai-provider.ts`, `ai-crypto.ts`                                                                                                                                                                                   |
| Database      | New `database/migrations/004-ai.ts`; updated `database/scripts/migrator.ts`, `packages/database/src/index.ts`                                                                                                                                       |
| API           | New `services/api/src/ai-routes.ts`; updated `app.ts`, `main.ts` in the same directory                                                                                                                                                              |
| Dashboard     | New `apps/web/src/AI.tsx`; updated `App.tsx`, `styles.css`                                                                                                                                                                                          |
| Operations    | New `scripts/configure-ai.mjs`, `scripts/rotate-ai-keys.ts`; updated `scripts/check-persistence.ts`, `package.json`, `.env.example`, `packages/observability/src/index.ts`                                                                          |
| Tests         | New `tests/unit/ai.test.ts`, `ai-setup.test.ts`, `tests/integration/ai-scenarios.ts`, `tests/e2e/ai.spec.ts`; updated integration `database.test.ts`, `core-scenarios.ts`, `reminder-scenarios.ts`, security `startup.test.ts`, and e2e `server.ts` |
| Documentation | New `docs/10-m1-5-ai-provider-foundation.md`, this report; updated README, master context, technical architecture, API specification, roadmap, ADR-016, runbook and threat model                                                                    |

Migration 004 creates `ai_configs`, `ai_conversations`, `ai_messages`, `ai_requests`, `ai_rate_windows` and advances readiness to schema 4. Applied to fresh isolated test databases, not the user's development database during this task. Normal startup runs pending migrations. Existing M1/M2 tables are preserved.

Implemented routes under `/api/v1`: `GET /ai/providers`, `GET/PUT/DELETE /ai/config`, `POST /ai/test`, `GET /ai/conversations`, `GET /ai/conversations/:id`, `GET /ai/requests/:id`, `POST /ai/chat`. Full payloads and errors are documented in the specification.

## Actual verification

| Command/check                                | Final result                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run format`                             | Passed                                                                                                                                                     |
| `npm run check`                              | Formatting, ESLint, both TypeScript projects and **21 unit/security tests passed**; zero failed/skipped                                                    |
| `npm run build`                              | Passed; production frontend built successfully                                                                                                             |
| `./scripts/verify-local.ps1`                 | **31 PostgreSQL tests passed**, including the parent migration test and M1 assertions; zero failed/skipped                                                 |
| Real PostgreSQL stop/start persistence check | Passed for M1 task, M2 reminders/attempts/receipts, encrypted AI configurations, chat responses and unknown requests                                       |
| `./scripts/verify-local.ps1 -Browser`        | **4 Edge browser tests passed**: AI workflow, M1 dashboard, reminder management, independent-worker delivery                                               |
| `npm audit --audit-level=high`               | Passed: **0 vulnerabilities**                                                                                                                              |
| Visual inspection                            | Inspected `.local/m1-5-chat.png`; dashboard styling preserved, provider HTML shown as inert text. Browser check confirms no horizontal overflow at 390 px. |

Final integration database: `axis_test_cc32fcf89f65`. Final browser database: `axis_test_e2e_f624939c11ca`. Synthetic databases retained for inspection; verification shut down the local PostgreSQL cluster it started. No test-only authentication/provider adapter is enabled in production.

Coverage includes fixed endpoint/auth header construction, unsupported models, quota/rate/auth/outage errors, timeout and response-size limits, malformed/tool responses, secret redaction, GCM tampering and cross-owner AAD rejection, random nonces, versioned key rotation, rollback with a wrong old key, missing/invalid configuration, per-user keys and context, foreign conversation/request denial, concurrent replay, hash conflict, three-attempt ceiling, unknown recovery, DB-backed rate limits, escaped output and browser retry/dismiss behavior. Existing Google session expiry/logout/CSRF, M1 CRUD/privacy and all M2 crash/lease/cancellation/recurrence tests passed. The real worker test includes a deliberately invalid AI master key.

Failures encountered and corrected: initial TypeScript errors in untyped SQL result/completion declarations; one unused-import lint error in the setup script; one AI browser test timeout using the label selector for a populated conversation select, corrected to its accessible combobox role. Review also found a mutable-ref rendering issue when dismissing a recovered request; state now drives that UI, and the browser recovery test passed. No final automated failures remain. No failures were attributed to existing M1/M2 behavior.

## Run locally

```powershell
npm run setup:ai
npm run dev
# In a second terminal:
npm run dev:worker
```

Open http://localhost:3000, sign in with the configured Google owner, then use AI Settings and Chat. `setup:ai` generates the server master key without displaying it and preserves existing settings. It does not configure or invent a provider key. Enter that key only in AI Settings. Existing Google and PostgreSQL setup remains unchanged.

New environment names: `AI_CREDENTIALS_ENCRYPTION_KEY` (required to enable AI), `AI_CREDENTIALS_KEY_VERSION`, `AI_CREDENTIALS_PREVIOUS_KEYS`, `AI_REQUEST_TIMEOUT_MS`, `AI_REQUESTS_PER_MINUTE`, `AI_MAX_OUTPUT_TOKENS`. Defaults and safe rotation procedure are in the M1.5 specification; no secret values appear in documentation.

## Remaining gates and limitations

- **Actual Groq test and chat request through the UI are pending.** The automated suites inject synthetic providers. Follow the exact manual procedure in `10-m1-5-ai-provider-foundation.md`; do not paste keys into the coding-agent conversation. Account/model availability, live response quality and live billing behavior remain unverified.
- NVIDIA is unimplemented. Only one active configuration per owner is supported. No streaming, fallback, tools, autonomous writes, M3/M4 features, or production deployment.
- M1 still allows one Google owner. Two-user isolation is tested with synthetic users at the service layer; a live second-user onboarding flow is intentionally absent.
- Context retrieval is lexical and bounded, not semantic. Sensitive memories are excluded; users explicitly opt into sharing task/project/ordinary-memory context. Conservative credential-pattern checks are not a general detector for every possible secret.
- UI lists the latest 100 conversations and latest 100 messages; prompts include at most 12 recent messages within a character budget. Older data remains in PostgreSQL; pagination, chat deletion/export and retention policies are not implemented here.
- No provider reconciliation exists for an unknown AI completion. Explicitly starting a new request can incur another charge; status polling never does. Deleting/replacing a key cannot recall an already registered call and does not revoke it at the provider.
- The encryption master key/keyring requires secure backup and restricted access. Rotation works transactionally in the single-owner baseline; large-scale rotation, production TLS, DB least privilege and backup/restore operations need a later operational review.

Stopped at M1.5. M3/M4 work requires review and separate authorization.
