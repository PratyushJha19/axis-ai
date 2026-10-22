# Telegram on free Render hosting

For incoming task/reminder commands and webhook wake-up, use the newer
[Telegram command setup](telegram-commands.md). The polling-only instructions
below remain valid when no webhook secret is configured.

Updated 2026-10-21. The owner accepted delayed notifications on free hosting.
This is an optional override of the worker-free demo, not an always-on service.
No paid worker or keep-alive service is introduced.

## Deploy the update

1. Commit and push the current code, including the new scripts, package command,
   backend/configuration changes and frontend notice. Do not commit credentials.
2. In the existing Render **free web service**, change **Start Command** to:

   ```text
   npm run start:free
   ```

3. Keep the build command `npm ci --include=dev && npm run typecheck`.
4. In **Render → Environment**, preserve the current database, OAuth, encryption
   and session settings. Add/update:

   | Variable                   | Value                           |
   | -------------------------- | ------------------------------- |
   | DEMO_MODE                  | `true`                          |
   | FREE_HOST_NOTIFICATIONS    | `true`                          |
   | NOTIFICATION_MODE          | `live`                          |
   | TELEGRAM_BOT_TOKEN         | Your private BotFather token    |
   | TELEGRAM_BOT_USERNAME      | Exact bot username, without `@` |
   | NOTIFICATION_PUBLIC_ORIGIN | `https://axis-ai-xi.vercel.app` |
   | APP_ORIGIN                 | `https://axis-ai-xi.vercel.app` |

   Keep HOST=`0.0.0.0` and TRUST_PROXY_HOPS=`1`. Leave email/Twilio credentials
   unset for Telegram-only use. Keep secrets on Render, never Vercel or in chat.
   Use a dedicated bot; do not run another application or webhook for this bot.

5. Save and redeploy Render. Redeploy Vercel for the updated sleep warning.
   The `render.yaml` template keeps notification opt-in false and mock delivery
   by default; recheck these values after applying a Blueprint update.

The launcher migrates first, then starts API and reminder worker as separate Node
processes inside the same free web service. It never starts the agent worker.
If either child exits unexpectedly, the launcher stops its sibling and exits with
failure so the hosting platform can restart the service. Shutdown is bounded;
existing database leases/unknown-outcome handling remain the recovery authority.

## Link and enable your account

1. Open AXIS and **Alerts & channels**. Refresh to wake the API and wait for the
   Telegram polling status to become healthy.
2. Click **Get linking code**.
3. Open your bot in a private Telegram chat and send the exact `/start …` command
   shown by AXIS. Complete it within ten minutes.
4. Return to AXIS and click **Refresh channels and history**.
5. Select **Enable Telegram reminders**, check the authorization box and save.
6. Click **Send Telegram test** once and check the recorded attempt and Telegram.
7. Create a new reminder a few minutes ahead. Existing mock-only reminders do not
   silently become live Telegram sends; recreate one for this test.

Linking is not delivery consent. Sending `/stop` or disconnecting revokes pending
delivery under the existing rules. Never repeatedly send a test merely because an
earlier outcome is unknown. Telegram confirmation means sent, not read/delivered.

## Free-host limitations

Render may stop the web service while idle. This stops Telegram polling and all
reminder work too. Sending a Telegram message cannot wake AXIS because this setup
polls Telegram; it has no inbound Telegram webhook. Open AXIS and make an API
request (for example Refresh channels) to wake it. A static Vercel page alone does
not necessarily wake Render.

Overdue reminders persist in PostgreSQL. On wake, the existing scheduler processes
one overdue recurrence and skips/counts missed repeats. Quiet hours, focus blocks,
consent, bounded retries and unknown outcomes still apply. An expired linking code
needs a new code. No on-time or 24/7 guarantee is made.

While awake, the existing worker also performs archive retention and already
opted-in planning alerts. No new alert consent is enabled. Delegated agent runs
remain unavailable. All processes share Render's memory allowance; an out-of-memory
restart and free database compute limits can delay delivery further. Frequent
polling keeps the database active while the host is awake; monitor free quotas.

Do not enable a second local worker against the same bot and a different database.
Use a separate development bot for local testing. The worker's durable poll lease
handles overlapping workers using the same database, not two separate databases.

## Troubleshooting and rollback

- `/auth/status` through Vercel should include `demoMode: true` and
  `freeHostNotifications: true`. These flags show configuration, not delivery health.
- Render logs should include `free_host_started`, `api_started`, `worker_started`
  and eventually `telegram_poll_ready`. Use Alerts & channels for current health.
- If polling fails, check bot token/username and ensure no webhook/other application
  owns the bot. Never paste token-bearing Telegram URLs into logs or chat.
- If the old demo error appears, verify the latest commit, start command and flag.
- To disable again, set FREE_HOST_NOTIFICATIONS=`false` and NOTIFICATION_MODE=`mock`,
  then redeploy. Preserve the database and token privately; do not delete records.

See [Telegram details](telegram-setup.md) and [base deployment](render-vercel-demo.md).

## Verification

- `npm run check`: formatting, lint, types and all 53 unit/security tests passed.
  Includes sibling-process failure/shutdown, explicit opt-in configuration and
  continued default refusal of demo workers. An initial sandbox run blocked four
  loopback API tests with EACCES; the rerun with local network access passed.
- `npm run build`: passed.
- `./scripts/verify-local.ps1`: all 110 integration tests passed against
  `axis_test_2456de7df3ba`. The worker restart scenario resumes persisted work
  with DEMO_MODE and FREE_HOST_NOTIFICATIONS enabled; providers remain mocked.
  Existing Telegram linking/consent, poll lease, duplicate, crash and unknown
  outcome tests pass. Agent submissions remain blocked even with the override.
  PostgreSQL first needed crash recovery; tests ran only after recovery completed.
- `./scripts/verify-local.ps1 -Browser`: all 11 browser tests passed against
  `axis_test_e2e_4999021cae43`, including both default-demo and enabled-notification
  notices. Notice tests mock the status response; backend/process tests separately
  cover the actual mode restrictions. No live provider is used by browser tests.

No live Telegram send, provider configuration change or cloud deployment has been
performed by this implementation. Local process tests do not prove Render signal
forwarding, cold-start behavior, memory headroom or live Telegram delivery. Verify
those using the explicit user test above. No new migration or dependency is needed.
