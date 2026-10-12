# M2 local operation and API

M2 implements durable reminders with **mock-only delivery**. A simulated delivered
status proves a durable mock receipt, not receipt of a WhatsApp message or email.
Existing Google owner authentication protects the reminder UI/APIs.

## Start locally

From `G:\axis-ai`, install the lockfile dependencies with `npm ci` if needed.
Stop an older API instance before restarting; port 3000 must be free.

Terminal 1:

```powershell
npm run dev
```

This starts the existing local PostgreSQL cluster if necessary, runs migration 003,
builds the dashboard and starts the API at http://localhost:3000. The database now
stays running when the API exits. This is necessary for independent worker operation.

Terminal 2:

```powershell
npm run dev:worker
```

Check worker health from another terminal:

```powershell
npm run worker:health
```

With PostgreSQL already running, the lower-level commands are `npm run db:migrate`,
`npm run build`, `npm run dev:api` and `npm run dev:worker`. Both processes must use
the same DATABASE_URL and schema version 3. The worker polls once per second and
processes one claim per iteration. A process timer only triggers polling; the database
holds every schedule, attempt and lease. Restarting the API is unnecessary for worker
recovery. Restarting the worker reclaims expired leases and reconciles uncertain sends.

In the dashboard, open **Reminders**, set your profile timezone if needed, enter an
explicit local time, preview it, then confirm. Edit/reschedule, snooze and cancel are
available before dispatch. Attempt history, skipped repeats and attention states are
visible. Use Refresh reminders to update status; no auto-refresh/live subscription is
claimed. Quiet hours and focus blocks are configured on the same page.

Stop API/worker with Ctrl+C. To stop the local database after both have stopped:

```powershell
& 'C:/Program Files/PostgreSQL/18/bin/pg_ctl.exe' -D .local/pgdata -m fast stop
```

No Windows service or startup task is installed. Reminders wait durably while the
worker or machine is off; this local milestone is not an uptime guarantee.

## Configuration names and defaults

Keep `.env` private. Required worker setting: `DATABASE_URL`. The authenticated API
also uses the existing `APP_ORIGIN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`OWNER_EMAIL`, and `SESSION_SECRET`. `PORT` and `LOG_LEVEL` remain optional. No model,
Twilio or email credentials are required or accepted for notification delivery.

All new variables are optional; blank means default:

| Variable                     | Default | Meaning                                          |
| ---------------------------- | ------- | ------------------------------------------------ |
| REMINDER_LEASE_MS            | 60000   | Claim expiry; must exceed twice the call timeout |
| REMINDER_TIMEOUT_MS          | 5000    | Bounded send/reconciliation timeout              |
| REMINDER_MAX_ATTEMPTS        | 3       | Maximum send attempts per occurrence, 1–10       |
| REMINDER_MAX_RECONCILIATIONS | 3       | Automatic reconciliation queries, 1–10           |
| REMINDER_RETRY_BASE_MS       | 30000   | Exponential backoff base                         |
| REMINDER_RETRY_CAP_MS        | 900000  | Backoff cap; maximum 15 minutes                  |

Changing retry configuration requires worker restart. A reminder left needing
attention is not silently restarted by that change. Use edit/reschedule for a confirmed
failure or **Reconcile status again** for an unknown/sent outcome needing attention.
Never manually change an uncertain state to scheduled to force a resend.

Quiet hours/focus blocks are owner-scoped database preferences. Quiet hours use the
current profile timezone; existing recurring schedules keep their saved zone. No
urgent exceptions exist. Removing a block does not pull an already-deferred attempt
earlier; its visible next-attempt time remains until explicitly rescheduled/snoozed.
Focus-block times are absolute instants; overlapping blocks are rejected. The UI
supports up to 100 stored blocks and explicit removal of expired ones.

Recurrence supports once/daily/weekly. Recurrence edits start a new logical occurrence;
occurrence numbers therefore include schedule revisions, not just deliveries. Snooze
preserves the recurrence anchor. DST reject mode pauses ambiguous future occurrences
for review. One-off past-due times are allowed and visibly confirmed before creation.
For deadline offsets, link the task and enter an explicit time before/on/after its
deadline; automatic task-deadline synchronization and multi-offset generation are not
implemented. M1 task recurrence is unchanged.

## Endpoints

All paths below are under `/api/v1`, require owner authentication, and use existing
Origin/CSRF protection on writes. Bodies reject unknown fields. Create requires a
UUID `Idempotency-Key`; mutations require the current integer `If-Match` version.
Preference initialization uses version 0. Lists use `limit` (1–100, default 30) and
`offset` (default 0); responses have `items` and `hasMore`.

| Method/path                   | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| GET/POST /reminders           | List/create                                                     |
| POST /reminders/preview       | Resolve a wall time to UTC without saving                       |
| GET/PATCH /reminders/:id      | Inspect/full edit/reschedule                                    |
| POST /reminders/:id/cancel    | Cancel schedule and future repeats; body `{}`                   |
| POST /reminders/:id/snooze    | Defer current occurrence to a chosen future time                |
| POST /reminders/:id/reconcile | Request bounded reconciliation of an attention state; body `{}` |
| GET /reminders/:id/attempts   | Paginated attempt history                                       |
| GET/PUT /reminder-preferences | Read/update quiet hours and focus blocks                        |
| GET /system/status            | Worker freshness, owner due/unknown/attention counts and lag    |

Schedule input is `local_due` (`YYYY-MM-DDTHH:mm`), `timezone` matching the profile,
and `disambiguation` (`reject`, `earlier`, `later`; default reject). Create/edit also
accept `title`, `body`, nullable `task_id`/`project_id`, `recurrence`
(`none`, `daily`, `weekly`) and require `confirmed: true`. Preview and snooze accept
only schedule fields. No caller-supplied user ID, delivery status, channel or lease
can be written. Preferences contain nullable `quiet_start`/`quiet_end` (`HH:mm`) and
`focus_blocks: [{start, end}]` with explicit-offset ISO timestamps.

## Recovery and diagnostic meanings

- `scheduled`/`snoozed`: durable queued work, not delivery.
- `processing`: dispatch has started; lease recovery reconciles before any retry.
- `sent`: mock accepted; delivery unconfirmed.
- `delivered`: simulated receipt confirmed; recurring schedules advance atomically.
- `unknown`: outcome cannot be confirmed. Reconciliation is scheduled or needs attention.
- `failed`: confirmed failure or recurrence requires review. Check reason and next attempt.
- `cancelled`: cancellation won before dispatch; future repeats are cancelled too.

A healthy heartbeat is no older than 90 seconds; stopped workers turn stale after
that grace window. `/health/ready` on the API checks schema/database; `worker:health`
does not depend on the API. Logs include IDs, correlation IDs, status and mode but
never reminder bodies or raw provider errors. `worker_dependency_unavailable` means
the worker loop could not complete its database/processing step; its persistent work
will remain recoverable by lease expiry. Inspect due count and lag as well as heartbeat.

Migration is additive. Do not roll the schema back or delete attempt/receipt history
to troubleshoot delivery. M3 must implement provider-specific reconciliation and
notification authorization; M6 must prove backup/restore reconciliation separately.
