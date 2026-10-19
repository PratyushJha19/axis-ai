# M5 — Daily intelligence and planning

## Audit and design — 2026-10-18

Reuse React/Express/PostgreSQL, Google sessions, BYOK, M2/M3 scheduler and M4.5.
Tasks have priority, due UTC/IANA zone, estimates, completion timestamps and status
events. Projects have names/descriptions/status but no priority or deadline.
Task recurrence/dependency edges and Calendar integration do not exist. Existing
focus blocks are absolute unavailable intervals. Do not invent missing evidence.

Acceptance: deterministic explainable ranking; local-day/week briefing and
project summaries; optional validated AI recommendations with deterministic
fallback; editable daily/weekly plans with real IDs, estimates, availability,
buffers, hard deadlines and conflicts; explicit acceptance/history; safe recovery
using task/reminder services; owner isolation; opted-in deduplicated alerts through
existing reminders; regression and recovery tests. No live calls or M6 expansion.

## Policy and architecture

Migration 011 adds planning preferences, versioned plans, recommendation
generation receipts and durable proactive-event identities. No parallel task or
notification store. Week starts Monday unless configured otherwise. Availability
is empty until explicitly supplied. Missing estimates remain unscheduled.
Proactive alerts default off; users choose briefing time and deadline lead time.
This resolves open timing through configuration rather than an irreversible policy.
Calendar-aware planning is explicitly unavailable.

Rank v1: explicit priority (low 0, normal 20, high 40, critical 60), overdue +80,
due within 24h +50, within 7d +20. Stable due-date/ID tie breaks. Blocked and deferred
tasks remain visible but are not auto scheduled. No numeric productivity claims.
Fetch bounded source data and disclose truncation. Optional AI uses relevant
ordinary memory only with explicit consent and returns validated task IDs and
recommendation text; no model write/execution authority. Persist request receipts
before inference, no inference transaction, no retry after unknown outcomes.

Plan acceptance is an explicit reversible internal write under ADR-023's CRUD
exception; it never changes due dates or creates reminders/calendar events.
Rescheduling is a separate explicit preview/confirm operation. Users choose to
cancel active linked reminders or shift their existing offsets; if any reminder
has begun dispatch or is unresolved, fail the whole change. Model tools remain
read-only for M5; protected create tools continue through M4.

## Implemented services and interface

`PlanningService` loads up to 500 non-archived tasks and 200 projects; truncated
sources are labelled. Priorities have a paginated API/UI. Completed/cancelled work
is excluded from priorities; overdue means the task's actual due time passed.
Project counts use real linked tasks, including blocked status. Current completion
timestamps support this week's completed work; reopened work is not misreported as
currently complete. There is no invented project deadline, blocker reason or
business-health score. Plan detail compares stored task versions with current
records and marks elapsed incomplete blocks as missed.

Daily/weekly drafts share one deterministic scheduler. Explicit working windows,
existing focus blocks, other accepted plan blocks and configurable buffers bound
capacity. Tasks are indivisible; missing estimates, blocked/deferred work, overdue
hard deadlines and capacity failures remain visible and unscheduled. Local wall
times use Temporal and reject ambiguous/nonexistent boundaries. Weekly dates align
to the configured first day (Monday by default). No recurring-task inference.

Plan edits and acceptance revalidate ownership, task versions, estimates, current
availability, focus blocks and accepted-plan overlaps under an owner transaction.
An older draft cannot overwrite a newer version. Discarding a plan leaves tasks
unchanged. Time blocks reserve planning capacity, not calendar events. Separate
recovery shows linked reminders and requires explicit confirmation of cancellation
or offset-preserving shift. Task/reminder writes commit together through existing
services, or all roll back. No in-flight message recall is promised.

The **Planning** page adds briefings, priority selection/feedback, AI suggestions,
availability settings, daily/weekly draft generation, editable ordered blocks,
accept/discard controls, history, progress and recovery. The existing Overview has
a compact briefing and links to actual task/project editors. Navigation/reload warns
about unsaved plan edits. Planning code is loaded separately from the main bundle.

## Optional AI and memory

Explicit refresh uses the user's existing encrypted BYOK configuration. It sends
at most 20 task summaries and, only for an explicit memory search, five matching
ordinary memories. Global scope is the UI default; the API supports an explicitly
owned project. Sensitive/archived/foreign memory is excluded. Memory never silently
changes availability or durable preferences. Input/output credential guards and
existing provider timeout/usage limits remain active.

The strict response contains at most five unique, supplied task IDs and short
recommendations. Unknown IDs, extra fields and malformed responses fail. Prose is
always labelled as advice, not execution evidence. Users may choose suggested
tasks for a deterministic draft; the model cannot directly create schedule blocks,
change due dates or approve actions. M4.5 adds read-only `get_daily_briefing` and
`get_plan`; existing write tools remain under M4. There is no second agent loop.

Five AI refreshes/hour/user, durable request hashes and a 90-second receipt expiry
bound regeneration. Unknown requests never automatically retry; replay returns
the recorded status. A user can explicitly start a new request. Calls occur outside
database transactions. Facts remain available if AI fails. Cached advice is used
only when source dates, task/project versions, reminder state, preferences,
ordinary-memory revision and urgency classifications still match. No scheduled
background AI calls or global provider credential is added.

## Proactive events and recovery

The existing reminder worker evaluates opted-in owners in bounded rotating batches
once per minute. It queues daily-briefing alerts and high/critical task approaching
or overdue alerts, with a maximum of five new events per owner's local day.
Deadline events use task ID, due-time digest and event kind; briefing events use
local date. Durable event IDs and reminder creation commit atomically. Restart,
concurrent evaluation and archive cleanup cannot recreate the same logical event.

Generated notifications use existing M2 recurrence/quiet/focus scheduling and M3
channel consent, transport history, timeout and reconciliation. Neither scheduling
nor delivery needs AI. Fresh reminder/channel dispatch rechecks optional consent
and source task status/due date. Completed/changed source tasks suppress queued
alerts. Already uncertain dispatches retain their evidence; there is no blind
resend or invented delivery confirmation. Disabling alerts cancels eligible queued
generated reminders; dispatch already begun cannot be recalled.

Briefing alert counts are labelled snapshots. Other proactive event kinds (project
deadlines, discovered calendar conflicts) are unavailable because their data source
does not exist. No independent scheduler or external service was provisioned.

## API

All routes are under `/api/v1`, authenticated and owner scoped. Writes require the
existing CSRF token and exact Origin; strict bodies reject owner/authority fields.

| Route                                   | Purpose                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| GET `/intelligence/briefing`            | Current local-day facts and valid cached advice                                                               |
| GET `/intelligence/priorities?offset=0` | Pages of 30 ranked tasks                                                                                      |
| POST `/intelligence/refresh`            | UUID `idempotency_key`, `consent:true`, optional `memory_query`, `project_id`                                 |
| POST `/intelligence/feedback`           | Owned `task_id`, `kind`: dismissed/not_useful                                                                 |
| GET, PUT `/planning-preferences`        | Versioned availability, first day, buffer, alert opt-in/lead/briefing time                                    |
| POST `/plans/generate`                  | UUID key, local `date`, daily/weekly `kind`, priority/timeblock `mode`, optional ordered `task_ids` (100 max) |
| GET `/plans?offset=0`                   | Pages of 20 saved plans                                                                                       |
| GET `/plans/:id`                        | Saved plan, current task statuses/version changes and missed blocks                                           |
| POST `/plans/:id`                       | Expected `version`, edit/accept/discard `operation`, validated optional `document`                            |
| GET `/intelligence/recovery/:taskId`    | Current task and active linked reminder versions                                                              |
| POST `/intelligence/recovery/:taskId`   | UUID key, task version, new local due, reminder IDs/versions, cancel/shift policy, explicit `confirmed:true`  |

Recovery accepts optional reject/earlier/later DST disambiguation. The UI rejects
ambiguous times; select an unambiguous time or use the explicit API interpretation.
Changing the date/timezone of an existing plan requires a new draft. There is a
500-accepted-plan safety bound; discard older accepted plans when necessary.

## Run, limitations and verification

Stop old processes, then `npm run dev` applies migration 011 and starts API/web.
Use `npm run dev:worker` for reminders and opted-in proactive alerts. The existing
`npm run dev:agent` remains necessary for agent runs, but deterministic planning
and manual AI refresh work without it. No new environment variable is required.
Delivery remains mock unless existing notification configuration explicitly enables
live operation. See `m5-results.md` for actual test results.

Calendar, project deadlines/priority, dependency graphs, recurring tasks, automatic
task splitting and external writes are not simulated. Historical comparisons are
limited to saved plans versus current task versions/status and recorded completion
timestamps; deleted/archived/out-of-query tasks show unavailable. No general
historical productivity analytics or automatic plan/history retention is claimed.
Live Groq planning quality and live Telegram delivery remain manual consented
checks. This milestone does not deploy or start M6.
