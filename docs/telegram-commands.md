# Telegram task and reminder commands

Scope: first Telegram command slice, 2026-10-21. Private linked accounts can list
tasks/reminders, propose creation, rename/complete tasks, cancel reminders and move
their next attempt. Every change uses the M4 approval ledger with a 24-hour expiry.
The owner selected permanent deletion in the signed-in dashboard. Projects,
memory, planning, Calendar writes and delegated agent runs are not Telegram tools.

## 1. Deploy the code

Commit and push the changes, excluding `.env` and all credentials. Redeploy the
existing Render backend and Vercel frontend. Render remains a free web service:

- Build: `npm ci --include=dev && npm run typecheck`
- Start: `npm run start:free`

The start command applies migration 013 and starts the API and reminder worker.
With commands enabled, it also starts a separate Telegram command worker so an AI
outage does not block reminders. It does not start the delegated agent worker.
All three processes share the free service's resources; no uptime guarantee is made.

## 2. Configure Render

Keep existing database, Google sign-in, session and encryption settings. In the
backend service's Environment page set:

```dotenv
DEMO_MODE=true
FREE_HOST_NOTIFICATIONS=true
NOTIFICATION_MODE=live
TELEGRAM_COMMANDS_ENABLED=true
TELEGRAM_BOT_TOKEN=your_existing_private_BotFather_token
TELEGRAM_BOT_USERNAME=your_existing_bot_username_without_@
APP_ORIGIN=https://axis-ai-xi.vercel.app
NOTIFICATION_PUBLIC_ORIGIN=https://axis-ai-xi.vercel.app
TELEGRAM_WEBHOOK_SECRET=your_new_random_secret
```

Use your existing bot; creating another one is unnecessary. Generate a secret
locally with this command, then copy its output privately into Render and your
ignored local `.env`. Do not share it or commit it:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

These settings belong on Render, not Vercel. Save and redeploy. Confirm the logs
include `telegram_command_worker_started` as well as the API and reminder worker.
Webhook mode disables polling; `telegram_poll_ready` is not expected in this mode.

## 3. Register the webhook once

Registering a webhook changes the bot's configuration. AXIS never does this
automatically. In your local ignored `.env`, set the same notification mode, bot
token, bot username and webhook secret as Render. Add:

```dotenv
TELEGRAM_WEBHOOK_URL=https://axis-ai-1nsn.onrender.com/webhooks/telegram
```

Use the **Render backend URL**, not the Vercel frontend. Stop local workers using
the production bot before switching transport. From the project folder run:

```powershell
npm run telegram:webhook -- set --apply
npm run telegram:webhook -- status
```

The first command should report `Telegram webhook set confirmed.` The second
should report `configured: true`. It prints no bot token or raw provider error.
If the request was interrupted, run `status` before retrying. No messages are sent
by registration. Pending Telegram updates are preserved, not discarded.

Telegram supports either polling or a webhook for a bot. A webhook delivers an
incoming message to Render, which can wake the free service. Cold starts may delay
the response; Telegram retries webhook delivery, and AXIS deduplicates updates.
This does **not** keep scheduled reminders running while Render sleeps.
References: [Telegram webhook guide](https://core.telegram.org/bots/webhooks),
[Bot API](https://core.telegram.org/bots/api#setwebhook).

## 4. Link your account

1. Sign in to AXIS and set your timezone in Settings, for example Asia/Kolkata.
2. Open Alerts & channels. If your account is already verified with this bot,
   retain that link. Otherwise click Get linking code.
3. Send the exact `/start …` message to the bot in a **private chat**, within ten minutes.
4. Refresh channels in AXIS to verify the link. Linking does not enable reminders.
5. Enable Telegram reminders and save consent if you want scheduled delivery.
6. In Telegram, send `/help`. Commands and replies do not use the three-tests-per-hour quota.

Each AXIS user links their own Telegram account. Never share linking codes.
Sending a command requests a reply in that private chat. `/stop` or Disconnect
Telegram revokes command access as well as reminder consent. Relink to resume.
Changing notification settings invalidates queued commands and pending Telegram
confirmation bindings; request a fresh preview after saving settings.

## 5. Try commands

```text
/task Finish the report
```

The bot returns a preview and two commands containing the action's unique ID.
Copy and send `/confirm <the actual ID>` to execute, or `/reject <the actual ID>`
to dismiss. A plain “yes” does not authorize changes. Only the backend's success
reply or the dashboard record proves completion. Review the exact title, target,
timezone, date, recurrence and expiry first.

```text
/tasks
/reminders
/remind 2027-01-02T09:00 | Submit report
/complete TASK_ID
/rename TASK_ID | Updated report title
/reschedule REMINDER_ID | 2027-01-03T10:00
/cancel REMINDER_ID
/status
```

Replace the example dates with future dates. Replace TASK_ID and REMINDER_ID with
the full IDs returned by the list commands. Lists show at most ten recent items;
use the dashboard for larger lists. Rescheduling moves the **next attempt** using
the existing snooze operation; it does not rewrite the recurrence's base schedule.
Cancellation cannot recall a message already sent and respects the dispatch race
and unknown-outcome rules. Completed/cancelled reminders follow existing archive
retention. Permanent deletion remains a dashboard operation.

For natural-language creation, first configure your own AI provider/key in AXIS
AI Settings and ensure the backend encryption key remains configured. Then try:

```text
Create a task to finish the report
Remind me tomorrow at 9 AM to submit the report
Remind me every Monday at 6 PM to review my plan
```

Each natural-language message is interpreted independently, using the linked
user's saved provider/key and timezone. It can draft creation only. It does not
retrieve private memory or previous Telegram conversation history. If a request
is unclear, restate the full request with the missing detail. Model suggestions
are untrusted until you review and confirm the server-validated preview. Use the
slash commands for edits and lists; these work without AI. Never send credentials
or sensitive memory to the bot. Telegram chats are a third-party surface.

## 6. Optional Telegram menu

Open the official BotFather account, send `/setcommands`, choose your existing
bot, and paste:

```text
help - Show AXIS commands
tasks - List recent tasks
reminders - List recent reminders
task - Propose a task with a title
remind - Propose a timed reminder
complete - Propose task completion by ID
rename - Propose renaming a task
reschedule - Move a reminder next attempt
cancel - Propose cancelling a reminder
confirm - Confirm an action ID
reject - Reject an action ID
status - Show recent command results
stop - Revoke Telegram access
```

This menu is optional. It does not grant permission or change AXIS security.

## Recovery and local operation

- `/status` reports the last five command/reply states. A reply timeout is unknown;
  AXIS never blindly resends it. Review Approvals and the record in the dashboard
  before repeating a request that might have committed.
- Interrupted inference becomes unknown after its 90-second lease. It is not
  retried automatically. Queued commands older than 24 hours are suppressed.
- Invalid, group, forwarded and unlinked commands have no effect. Unlinked chats
  receive no personal data. There is a 20 accepted-commands/minute/user bound;
  additional updates in that minute are dropped without a reply.
- Command text is erased after processing. Command/reply details expire after
  seven days of worker cleanup. Approval/audit/dedupe records retain their existing
  lifecycle. No message contents or provider URLs are logged.
- Operator restore marks queued/in-flight commands and replies unknown and
  invalidates Telegram confirmation bindings before keeping the restored database
  quarantined. Reconcile the approval ledger before releasing recovery quarantine;
  a snapshot cannot prove what happened after it was taken.
- For local polling with a **separate development bot**, omit the webhook secret,
  enable commands and run `npm run db:migrate`, `npm run dev:api`,
  `npm run dev:worker`, and `npm run dev:telegram` in separate terminals.
- To switch the same bot back to polling, explicitly run
  `npm run telegram:webhook -- delete --apply`, then remove the webhook secret
  from Render and redeploy. Never run two databases against the same bot.
- To disable commands, set TELEGRAM_COMMANDS_ENABLED=false and redeploy. This
  does not disable separately consented reminders.

Live Render cold starts, bot registration and live provider delivery must be
checked by the operator after deployment. Implementation verification is recorded
in `telegram-commands-results.md`.
