# Groq model selection — 2026-10-15

Scope: M1.5 maintenance requested by the owner. Replace the two-model whitelist with current Groq catalog lookup and validated manual text model IDs. No new milestone, database migration, deployment, or live inference performed.

## Changes

- `packages/domain/src/ai-provider.ts`: fixed authenticated catalog endpoint, bounded and validated responses, deduplication, inactive-model filtering, known audio/agent restrictions, model-access errors, GPT-OSS reasoning budget and empty-output-limit handling.
- `packages/domain/src/ai.ts` and `services/api/src/ai-routes.ts`: authenticated, owner-scoped, rate-limited `POST /api/v1/ai/models`. Entered keys are ephemeral; saved keys are decrypted only for their owner. Connection tests allow up to 1,024 output tokens, capped by server configuration.
- `apps/web/src/AI.tsx`: Load Groq models, editable model ID with catalog suggestions, unsupported modality details, explicit connection-test budget notice.
- Unit, database and browser AI tests cover catalog validation, key isolation, unsaved credentials, new model IDs and the settings/chat flow.
- `tests/integration/reminder-scenarios.ts`: worker and health subprocesses explicitly use mock notification mode. Previously they inherited local live settings, causing unrelated regression failures.
- ADR-020, provider specification and `setup_guide.md` document the new behavior.

## Actual verification

- `npm run check`: passed formatting, lint, both TypeScript checks and 33 unit/security tests. Initial sandbox run failed on local networking; the authorized rerun passed.
- `npm run build`: passed.
- `./scripts/verify-local.ps1`: final run passed all 63 tests against clean isolated database `axis_test_664de9facbd5`, plus persistence checks after a real PostgreSQL restart. Earlier attempts failed during PostgreSQL startup recovery and because worker/health tests inherited live notification mode; explicit mock fixtures resolved the latter.
- `./scripts/verify-local.ps1 -Browser`: all 6 passed against `axis_test_e2e_36eae5520073`, using synthetic identities and provider responses.
- `npm audit --audit-level=high`: zero vulnerabilities.

## Run and limitations

Restart with `npm run dev`. In AI Settings enter a key (or retain the saved key), click **Load Groq models**, choose/type a text model ID, and save. Enable test consent and test the saved connection. No new environment variables are required. Existing `AI_MAX_OUTPUT_TOKENS` controls chat output; connection tests cap it at 1,024.

Catalog loading does not generate a completion or save an entered key. Catalog presence is not proof of project entitlement. Groq may retire or restrict models, and individual models can reject particular text requests. Known audio-only models and autonomous agent systems are not supported by AXIS text chat. New model capability metadata is not universally available, so provider validation remains authoritative. No automatic model fallback or live-account validation was performed.

Provider references: [model catalog](https://console.groq.com/docs/models), [API reference](https://console.groq.com/docs/api-reference), [reasoning](https://console.groq.com/docs/reasoning).
