# Create tasks and reminders from chat

Updated 2026-10-15. Scope: owner-requested extension of M1.5 to create internal
tasks and personal reminders. This is not the general M4 external action executor.

## Use it

Stop the API and worker. Run `npm run dev` to apply migration `007-chat-actions`,
rebuild and start the API. Start `npm run dev:worker` in a second terminal.
For a system-managed database, use `npm run db:migrate`, `npm run build`,
`npm run dev:api`, and the independent worker instead. No new environment
variables or provider credentials are required.

Configure your timezone in Settings and your personal Groq connection in AI
Settings. Open Chat and try:

- “Create a task to read the project proposal.”
- “Remind me tomorrow at 9 am to submit the report.”
- “Remind me every Monday at 6 pm to review my weekly plan.”

Review the confirmation card's title, text, local date/time, timezone, UTC instant
and recurrence. Click **Confirm create task** or **Confirm create reminder**.
Only the backend's **Created** status confirms persistence. Manage the item in
Tasks or Reminders. A task due date does not itself schedule a notification.

If a draft is wrong, dismiss it and ask again. Unclear requests should produce
clarifying questions; models can still misunderstand, so check the preview.
Invalid dates, missing profile zones, past times and ambiguous DST times cannot
create timed items. Use the existing Reminders form for explicit DST earlier/later
choices. Changing your profile timezone requires a new timed proposal.

Proposals expire after 24 hours and survive reload. If confirmation's response is
lost, refresh history; retrying the same proposal cannot duplicate the record.
Separate chat requests create separate proposals and can intentionally create
separate records if both are confirmed. Existing cards are historical creation
evidence even if the item is subsequently edited or deleted elsewhere.

## Architecture and boundaries

- One new task or reminder per proposal. Tasks support title, description and
  optional due time. Reminders support title, body, time and none/daily/weekly
  recurrence. No batch writes, project linking, edits/deletes, memory capture,
  arbitrary recipients, external calendar actions or shell tools.
- Models return a strict JSON envelope through the existing text adapter. Native
  tool calling is not required. Plain prose remains an unverified answer, never
  an executable command. Malformed proposals cannot create records.
- The authenticated owner and configured IANA timezone come from the backend.
  Models cannot supply identity, destination, confirmation or approval. Relative
  date interpretation remains model-generated and must be checked in the preview.
- Migration 007 adds `ai_action_proposals`, owner/conversation/request foreign
  keys, unique request binding, payload hashes, expiry and an immutable-payload
  trigger. Readiness requires schema version 7.
- `POST /api/v1/ai/actions/:id/decide` accepts only `decision` (confirm/reject)
  and the displayed `payload_hash`. Session, CSRF and Origin checks apply.
  Owner-first locking serializes decisions. Record creation, audit and proposal
  consumption commit together; replay returns the stored record ID.
- Existing record/reminder domain methods compose inside the confirmation
  transaction using `inTransaction`. Their validation and idempotency remain.
- Reminders use the existing independent worker, quiet/focus rules and saved
  notification consent. Confirmation does not link channels, change destinations,
  enable live mode or send arbitrary messages. No general M4 authorization policy
  or high-risk action decision is changed.

## Files and acceptance

New files: migration `007-chat-actions.ts`, shared/domain `chat-actions.ts`, unit
`chat-actions.test.ts`, integration `chat-action-scenarios.ts`, this document.
Updated: migrator/schema readiness, record/reminder transaction composition,
AI service/routes/app/UI, multi-user API and AI/browser fixtures, documentation.

Acceptance: durable drafts; no write before confirmation; exact owned payload;
duplicate/replay protection; expiry and timezone checks; task/reminder creation
through the actual UI; existing regressions.

Actual verification:

- `npm run check`: formatting, lint, both TypeScript checks and 34 unit/security
  tests passed. An initial new-test type error was corrected before the pass.
- `npm run build`: passed.
- `./scripts/verify-local.ps1`: all 68 tests passed against clean isolated
  `axis_test_33b775aadad3`. Covers schema upgrade, database reconnection, creation,
  no write before approval, concurrent confirmation, immutable payload, owner
  isolation, CSRF/session checks, expiry, timezone changes and existing worker
  recovery. Initial migration-count assertion was updated for the new migration.
- `./scripts/verify-local.ps1 -Browser`: all 6 tests passed against
  `axis_test_e2e_8ccd929b41c4`. Chat test creates both a task and reminder and
  verifies persistence after proposal reload. Initial fixture failures involved
  a lingering profile toast and an already-set timezone; fixture setup was fixed.
- Existing PostgreSQL was running; verification did not stop/restart that shared
  cluster. Database reconnection and existing process-recovery tests passed.

No live Groq request, message, email, deployment or paid resource was used. Live
interpretation with the user's selected model still needs a user-run check.
JSON compliance and date interpretation vary by model; confirm only correct
previews. Free-form “yes” does not execute a proposal: use the confirmation card.
