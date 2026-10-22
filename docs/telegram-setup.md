# Telegram notifications for AXIS

For task/reminder commands and webhook mode, follow
[Telegram command setup](telegram-commands.md). Polling instructions below apply
when TELEGRAM_WEBHOOK_SECRET is unset.

For the deployed Vercel/Render free service, use
[free-host Telegram setup](free-host-telegram.md). Set secrets on Render and use
the shared-host launcher; the Windows commands below are for local development.

Updated 2026-10-15. Telegram replaces WhatsApp for new reminder deliveries.
Telegram's standard bot platform is currently free within its limits; this is not
a promise about future third-party pricing. AXIS explicitly disables paid
broadcasting. Email is optional and may have separate costs.

## 1. Create your bot

Install Telegram and open the verified **@BotFather** account. Send `/newbot`,
choose a display name, then choose an available username ending in `bot`.
Save the token BotFather provides privately. Use a dedicated AXIS bot, not a bot
already managed by another application or webhook.

The bot token belongs to the AXIS operator. Each application user links their own
private Telegram chat; users do not need their own bots or tokens.

## 2. Configure AXIS

Preserve the existing database, Google and AI settings in the root `.env`. Add or
edit these entries without duplicates:

```dotenv
NOTIFICATION_MODE=live
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_BOT_USERNAME=your_axis_bot
```

Use the username without `@`. Do not put the token in frontend settings, source
control, screenshots or chat. No Twilio account, phone number, domain, template,
public webhook or ngrok tunnel is required for Telegram. Leave email disabled if
you only want Telegram. `NOTIFICATION_PUBLIC_ORIGIN` is optional for Telegram;
without it messages omit the dashboard link. Existing Resend delivery still
requires its own credentials and public signed-webhook setup.

## 3. Upgrade and start

Stop the API and worker before applying migration 006. Do not stop or delete your
database. In the first terminal, from the repository root:

```powershell
npm run dev
```

The launcher applies migrations, builds the dashboard and starts the API. In a
second terminal:

```powershell
npm run dev:worker
```

Keep the computer awake and both processes running. The worker polls Telegram,
links accounts and processes reminder deliveries independently of the API and AI.
`npm run worker:health` checks scheduler readiness. Notifications also displays
whether Telegram polling has succeeded in the last 90 seconds.

Migration 006 preserves WhatsApp history but disables its consent and pending
dispatch. It does not turn a phone number into a Telegram identity. Email fallback
is disabled during the switch; explicitly re-enable it if wanted. Existing mock
receipts remain historical simulations, not Telegram sends.

## 4. Link your personal account

1. Sign in to AXIS at **http://localhost:3000** and open **Notifications**.
2. Confirm Telegram is configured and polling is receiving updates.
3. Click **Get linking code**. Keep this code private; it expires in ten minutes.
4. Open your bot's exact username in Telegram in a **private chat**.
5. Send the complete `/start …` command displayed by AXIS.
6. Return to AXIS and click **Refresh channels and history**.
7. Check **Enable Telegram reminders**, check the authorization box and save.
8. Click **Send Telegram test** once, then check your Telegram chat and history.

Linking proves possession but does not enable notifications automatically. One
Telegram chat can belong to only one AXIS account for a given bot. To switch
accounts, disconnect in the old AXIS account first. Send `/stop` to the bot, or
click **Disconnect Telegram** in AXIS, to revoke pending sends. Link again before
re-enabling. General chat messages are ignored; the bot does not run AI or actions.

## 5. Create a reminder

Confirm the timezone in Settings, then create a reminder a few minutes ahead.
Quiet hours and focus blocks apply to reminders and fixed channel tests. A saved
reminder is not proof of a sent notification. Open Notifications to inspect its
status and attempt history.

**Sent to Telegram** means Telegram returned a message ID. It does not prove that
the device received it or the user read it. Telegram provides no delivery/read
receipt or message-status lookup for this flow. Successful sends settle one-shot
reminders and advance recurrence without being labelled delivered.

Timeouts and crashes after dispatch remain **unknown**; AXIS never blindly
resends them. Optional email fallback can activate for an uncertain or failed
Telegram send. A confirmed send suppresses an unsent fallback. Late or uncertain
cross-channel delivery can still produce duplicates.

## Troubleshooting

A one-time reminder already marked **Sent to Telegram** has finished. There is
no future occurrence to cancel and AXIS cannot recall the sent message. Its card
keeps the delivery history but no longer offers Edit, Snooze or Cancel. The API
also explains this completed state instead of asking you to wait for reconciliation.
Recurring reminders advance to a new scheduled occurrence, which remains
cancellable before dispatch. Pending or unknown sends retain their existing
race and reconciliation protections.

| Symptom                     | Check                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Provider setup required     | Both Telegram settings exist and API/worker were restarted.                                                                           |
| Waiting for polling         | Worker is running, token is valid, network can reach api.telegram.org.                                                                |
| Polling conflict            | A different application or existing webhook is using this bot. Use a dedicated bot; AXIS never deletes remote webhooks automatically. |
| Code does not link          | Exact bot, private chat, correct unexpired code, worker running. Refresh or request a new code.                                       |
| Test disabled               | Live mode, configured bot, verified chat and saved explicit consent are all required.                                                 |
| No message yet              | Inspect history, quiet/focus windows and worker health. Three fixed tests/hour/user are allowed.                                      |
| Unknown outcome             | Inspect the chat manually; do not repeatedly resend. There is no Telegram status-query button.                                        |
| New bot after token changes | A replacement bot has a new ID; users must link it and save consent again. Token rotation for the same bot preserves identity.        |

Telegram retains incoming updates for at most 24 hours. Long outages can lose an
unprocessed `/stop`; use AXIS's disconnect control for immediate durable local
revocation. No local worker can process reminders while the computer is off.

## Verification and references

Live bot setup and delivery require your token and an explicitly consenting
recipient. Automated verification uses synthetic accounts and mocked HTTP only.
See [implementation results](telegram-results.md).

- [Telegram bot platform](https://core.telegram.org/bots)
- [Bot API: getUpdates and sendMessage](https://core.telegram.org/bots/api)
- [Bot limits](https://core.telegram.org/bots/faq)
