# M3 — Messaging and notification delivery

**Superseded for active WhatsApp setup on 2026-10-15:** Use
[Telegram setup](telegram-setup.md) and ADR-019. Telegram is the new primary;
WhatsApp history remains inspectable but dispatch is disabled. Email fallback is
optional. The Twilio sections below document the historical implementation;
Resend setup still applies only when explicitly enabling optional email.

Status: implementation present; automated verification recorded in `m3-results.md`.
Live delivery remains unverified. Stop after M3 for review.

## Repository audit and plan

React/Vite, Express sessions, PostgreSQL/Kysely and the independent M2 worker remain in place. M2 has durable reminder claims and attempt history but no channel outbox. Google verifies email at login, but the database needs an explicit verification timestamp. No live notification provider exists.

Extend M2 with an outbox adapter: the existing scheduler creates one delivery per occurrence/channel. A delivery processor in the same independent worker claims those rows. Reuse notification_attempts for transport attempts; preserve existing mock tests and default mock mode. No model or web process is required for polling or reconciliation.

Migration 005 adds notification preferences, email verification evidence, one-time phone linking challenges, delivery rows, webhook deduplication and rate windows. Settings, tests and history APIs use existing session/CSRF protection and owner scope. The dashboard gains Notifications without replacing other views.

## Policies

- Default mode is mock. Explicit live environment configuration plus saved user consent is required for transport calls. Consent covers personal reminders and fixed channel tests only, never messages to arbitrary recipients or model actions.
- WhatsApp phone proof uses a random single-use 10-minute code sent by the user to the configured Twilio number, authenticated by Twilio's signature. No verification message is sent by AXIS. STOP disables the channel; re-enabling requires a new link. Sandbox joining is separate.
- Email uses the current verified Google address and explicit settings consent. Existing accounts must sign in again to establish verification evidence; migration does not invent it.
- Default fallback window: 300 seconds from first durable WhatsApp dispatch, including an uncertain request. Configurable per user from 30 seconds to 24 hours. Permanent/configuration rejection permits immediate fallback. Confirmed delivery suppresses unsent fallback; unknown after the deadline permits one logical fallback and preserves the uncertainty. Late delivery can produce two channel deliveries and is shown honestly.
- Reuse M2 quiet/focus deferral for every new transport attempt, including fallback. Keep three attempts, 30-second exponential backoff with jitter capped at 15 minutes; honor bounded Retry-After on explicit rate rejection. HTTP 5xx/transport errors are unknown, never assumed safe to resend. Reconcile by known provider ID; unknown without an ID needs attention, never blind retry.
- Acceptance is distinct from sent/delivered/read. Delivered/read cannot be downgraded by older callbacks. All writes use database locks and logical unique keys; no transaction spans HTTP. External exactly-once delivery is not claimed.
- Fixed trusted provider endpoints, bounded request timeouts, no redirects or raw provider response logging. Twilio signatures use configured public URL, not Host headers. Resend uses Svix signatures over raw bytes with timestamp verification.

## Providers and official references

Twilio Sandbox initially; free-form text only within the inbound 24-hour service window. Outside it, require a configured approved Content SID with the documented variable contract; otherwise fail visibly and apply fallback. Production requires a separately configured approved sender/account, not an automatic credential fallback.

Resend is selected for a small HTTP adapter with delivery retrieval, signed webhooks and idempotency keys. No provider account or sending domain is provisioned. Its idempotency retention is finite; AXIS will not retry ambiguous sends on the assumption that the key lasts forever.

- [Twilio signature validation](https://www.twilio.com/docs/usage/security)
- [Twilio Sandbox restrictions](https://www.twilio.com/docs/whatsapp/sandbox)
- [Twilio message resource](https://www.twilio.com/docs/messaging/api/message-resource)
- [Resend signed webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Resend email retrieval](https://resend.com/docs/api-reference/emails/retrieve-email)
- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

## Acceptance

Clean/upgrade migrations; M1/M1.5/M2 regression; two-account isolation; immutable saved destinations; invalid signature rejection; duplicate/out-of-order callback handling; concurrent claims; cancellation/reschedule and consent revocation before dispatch; crash recovery without blind resend; unknown deadline fallback; confirmed-delivery suppression; late delivery history; missing configuration and failed email visibility; quiet hours; real PostgreSQL restart. Live Sandbox and email acceptance are separate pending manual checks, never inferred from mocks.

## Run locally

From the repository, install with `npm ci` if dependencies changed. Keep the existing local PostgreSQL and Google setup. Run `npm run dev` for migrations, frontend build and API on localhost:3000. Run `npm run dev:worker` in a second terminal; the API does not run the worker. `npm run worker:health` checks database readiness and the worker heartbeat. Alternatively run `npm run db:migrate`, `npm run build`, then `npm run dev:api`. Both processes must use the same notification mode/configuration. No AI key is needed for notification work.

The default `NOTIFICATION_MODE=mock` preserves M2 simulated receipts. No real job is dispatched in that mode, including previously queued live jobs. Read delivery configuration and saved channel state in **Notifications**. Sign out/in once after migration 005 to establish Google email verification evidence. Migrations do not backfill unproven email verification or alter existing reminders/data.

## Environment (server only)

| Variable                                                                                                                            | Meaning                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `NOTIFICATION_MODE`                                                                                                                 | `mock` by default; explicitly `live` to enable adapters                                                            |
| `WHATSAPP_SANDBOX_MODE`                                                                                                             | `true` by default; `false` selects the separate production variables                                               |
| `NOTIFICATION_PUBLIC_ORIGIN`                                                                                                        | Exact externally reachable HTTPS origin, without path/query/credentials; used for links and signature verification |
| `TWILIO_SANDBOX_ACCOUNT_SID`, `TWILIO_SANDBOX_AUTH_TOKEN`, `TWILIO_SANDBOX_WHATSAPP_FROM`                                           | Sandbox account credentials and `whatsapp:+...` sender                                                             |
| `TWILIO_SANDBOX_CONTENT_SID`                                                                                                        | Optional compatible approved template, subject to Sandbox restrictions; not an arbitrary template override         |
| `TWILIO_PRODUCTION_ACCOUNT_SID`, `TWILIO_PRODUCTION_AUTH_TOKEN`, `TWILIO_PRODUCTION_WHATSAPP_FROM`, `TWILIO_PRODUCTION_CONTENT_SID` | Separate production configuration; never substituted for Sandbox values                                            |
| `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`                                                                             | Resend API key, verified-domain sender email and Svix signing secret                                               |
| `REMINDER_TIMEOUT_MS`, `REMINDER_LEASE_MS`                                                                                          | Existing finite call timeout and lease; defaults 5s and 60s, lease must exceed twice timeout                       |
| `REMINDER_MAX_ATTEMPTS`, `REMINDER_MAX_RECONCILIATIONS`, `REMINDER_RETRY_BASE_MS`, `REMINDER_RETRY_CAP_MS`                          | Existing bounded worker policy; defaults 3, 3, 30000, 900000                                                       |

Missing channel configuration produces a safe configuration failure and eligible fallback. Set secrets privately in ignored `.env`, never in frontend variables or chat. Resend retrieval needs appropriate permission in addition to sending; use the least privilege available for the selected deployment. No free-tier or cost guarantee is made.

## Provider setup and pending manual acceptance

These steps can incur provider charges and send messages; perform them only for an explicitly consenting recipient. No account, sender, domain, tunnel or deployment was created by this milestone.

1. Configure Twilio Sandbox in your own console, get its join phrase and sender. Join from your own phone. Set the incoming-message POST URL to `<NOTIFICATION_PUBLIC_ORIGIN>/webhooks/twilio/inbound`. AXIS supplies the per-delivery status URL `/webhooks/twilio/status/<job UUID>` in each send request. Do not replace it with a generic callback URL. Ensure the HTTPS proxy preserves the path/body; AXIS verifies against the configured external origin rather than forwarded headers.
2. Configure Resend with a verified sending domain and sender. Register `<NOTIFICATION_PUBLIC_ORIGIN>/webhooks/resend` for sent, delivered, delivery_delayed, bounced, failed, complained and suppressed events. Save its signing secret privately. AXIS attaches the `axis_job` tag so an authenticated callback can recover even if the send response was lost.
3. Restart API and worker after explicitly selecting live mode. Sign in, open Notifications, request a linking code and send that exact code from the entered phone. Refresh, enable WhatsApp/email, check the consent box and save. Phone linking alone does not enable delivery. To change a phone, link the replacement; to disconnect, remove it. STOP disables WhatsApp and requires a fresh link before re-enabling.
4. Request one channel test using the clearly labelled button. Observe queued → accepted/sent → delivered where confirmed, inspect the provider console and history. No status response alone demonstrates actual recipient delivery.
5. Schedule a short reminder; confirm WhatsApp delivery suppresses email. Then, using a controlled missing/invalid WhatsApp configuration or unavailable template, verify email fallback to the same consenting user's verified address. Test unresolved primary fallback and late callback history with controlled sandbox fixtures before production use.
6. Restart the worker while a reminder is pending; confirm persistent state and no uncontrolled duplicates. Compare both channel histories and provider references. Record actual timestamps and result, without storing private bodies or secrets in the report.

Twilio Sandbox permits free-form replies only in a recent inbound service window and has provider-controlled participant/template restrictions. Outside that window AXIS requires a compatible approved template or records configuration failure and falls back. The template contract is one text variable `{{1}}` containing the concise reminder; whitespace is collapsed to satisfy variable restrictions. Existing Sandbox sample templates are not assumed to match this contract. Production template/sender approval is external setup, not supplied by this repository.

## HTTP contracts

All `/api/v1` routes below require the existing session. Mutations require exact Origin and CSRF token. No route accepts an arbitrary destination for sending.

| Route                                       | Behavior                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /notification-settings`                | Safe settings, verified Google address, provider readiness and Sandbox sender (no credentials)                      |
| `PUT /notification-settings`                | Enabled channels, fallback delay/enablement, current revision UUID and explicit consent                             |
| `POST /notification-settings/whatsapp/link` | `{phone}`; E.164 validation, five linking requests/hour; returns one private expiring code                          |
| `DELETE /notification-settings/whatsapp`    | Removes phone/proof and disables channel; invalidates queued consent                                                |
| `POST /notifications/test`                  | `{channel,consent:true}` plus UUID Idempotency-Key; three fixed tests/hour/user, saved destination only             |
| `GET /notifications?limit=20&offset=0`      | Paginated owner delivery history                                                                                    |
| `GET /notifications/:id`                    | Owner delivery details and bounded attempt history                                                                  |
| `POST /notifications/:id/reconcile`         | Empty object; another bounded status-query cycle for an uncertain delivery with a known provider ID, never a resend |

Webhook paths are outside browser authentication and require provider authentication. Bodies are bounded; Twilio uses all form fields in official signature validation and checks account/from/to binding. Resend uses the original bytes and Svix timestamp/signature verification. Unknown messages return an empty acknowledgment without changing records. Event IDs and state precedence prevent replay/downgrade. Webhooks cannot authorize actions or chat tools.

## Operations and limitations

Notifications history displays blocked, failed and unknown outcomes needing attention, channel attempts, fallback relation and confirmation time. `/api/v1/system/status` adds owner-scoped notification due/unknown/attention counters. Logs contain generated request/job/attempt identifiers and state only. Worker readiness proves a recent database heartbeat, not provider connectivity or delivery.

Three explicit rate-limit send rejections can exhaust the retry budget. Transport/5xx/malformed responses remain unknown. A known provider ID enables bounded lookup; without one, a signed callback is required for confirmation. Never manually reset an uncertain job to queued. After fixing a permanent configuration failure, review the old outcome before explicitly creating a new reminder/test. A blocked or failed recurring occurrence pauses, as in M2, rather than silently skipping failure. Later confirmed delivery advances the existing recurrence once when that occurrence is still current.

The first dispatch transaction is the cancellation/consent boundary. Queued live work can be cancelled/rescheduled before any channel attempt starts. Once an attempt begins, M2's conflict rule prevents edits that would disguise an in-flight send. Changing notification preferences prevents pending sends but cannot recall submitted messages. Content uses the existing reminder only; no memory, AI key or chat context is added.

Delivery timestamps indicate when AXIS recorded provider evidence; email delivered means provider-confirmed receipt by the recipient mail server, not that a human read it. Cross-channel duplicates remain possible after uncertain WhatsApp delivery. Small local worker throughput is intentionally bounded (10 sends/user/minute, 30/provider/minute, one fallback reconciliation per tick); this is not a public SaaS capacity guarantee. PostgreSQL restart tests do not prove backup/restore or production deployment reliability. Those remain later release gates.
