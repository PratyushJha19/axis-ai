# AXIS — Reminder and Reliability Specification

**Version:** 1.0 | **Priority:** Highest

**2026-10-16 retention update:** Finished one-time reminders and cancelled reminders
move to Archive, then become eligible for deletion after seven days. Active
recurrences and unresolved delivery work are protected. See [archive policy](reminder-archive.md)
and ADR-022 for migration, retention boundaries and verification.

## 1. Design objective

A reminder is a durable obligation with observable delivery state. It must not exist only in a chat transcript, model context, browser timer, or n8n execution history.

## 2. Reminder lifecycle

Suggested state machine:

```text
scheduled -> processing -> sent -> delivered
                    |          \-> unknown
                    |-> failed
unknown -> reconciled delivered / failed / retry scheduled
failed -> retry scheduled -> processing
scheduled -> cancelled
scheduled -> snoozed -> scheduled
```

Implementation may refine states, but must distinguish:

- Internal queueing from provider send.
- Provider accepted/sent from confirmed delivered.
- Confirmed failure from uncertain outcome.
- Cancellation from completion.

## 3. Reminder record requirements

Each reminder must include:

- Unique ID and user ID.
- Human-readable title and minimal notification body.
- Due timestamp in UTC and IANA timezone.
- Linked task/project/entity if relevant.
- Channel policy and fallback policy.
- Current status.
- Unique logical idempotency key.
- Attempt history.
- Next attempt/fallback timestamp.
- Created/cancelled timestamps.
- Correlation ID for tracing.

## 4. Creation policy

- If user provides a clear time/date, confirm interpretation and persist it.
- Interpret relative dates using the user's configured timezone.
- If time is missing, propose a time based on deadline and importance; ask before scheduling.
- If date/time is ambiguous, ask a single concise clarification.
- Before creating a reminder, show the title, due date/time with timezone, and channel policy.
- Support user edits, cancellation, snooze, and rescheduling.
- For deadlines, support configurable reminders at creation, before deadline, on due date, and after overdue. Exact offsets should be user-configurable; do not hard-code arbitrary timing without documenting it.
- Quiet hours and focus blocks apply to non-urgent notifications. Urgent exceptions must be explicit and configurable.

## 5. Worker processing

1. Find due reminders with `next_attempt_at <= now` or `due_at <= now`, status eligible.
2. Atomically claim the reminder using a lease/row-lock mechanism.
3. Check cancellation, quiet hours, user preferences, and idempotency.
4. Create a notification-attempt record before contacting the provider.
5. Call the provider with a stable idempotency key if supported.
6. Persist provider response and provider message ID.
7. Update status and next action based on provider semantics.
8. Release/expire claim safely.
9. Emit metrics and redacted structured logs.

A crash after provider send but before database update is a dangerous ambiguity. On restart, reconcile by provider message ID/idempotency key when possible. Do not blindly resend an uncertain notification.

## 6. WhatsApp primary and email fallback

Policy: WhatsApp is primary. Email fallback is attempted for **every reminder whose WhatsApp delivery is not confirmed**, according to a configurable timeout/retry policy.

- “Not confirmed” includes explicit failure and unresolved/unknown delivery after timeout.
- Use provider status callbacks/webhooks where available.
- The fallback timer starts from a defined event (proposed default: first WhatsApp attempt accepted by provider); record the chosen policy in configuration.
- Before fallback, query/reconcile current provider state if supported.
- If WhatsApp later reports delivered after email fallback, record both outcomes; do not erase history.
- Deduplicate email fallback by reminder ID and channel.
- Do not send email repeatedly for every retry cycle; one logical fallback notification should have its own idempotency key.
- Provider-specific delivery statuses vary. The adapter must map them into AXIS's normalized status without claiming more certainty than the provider offers.
- If the owner has no verified email, mark fallback blocked and surface a configuration alert rather than silently dropping it.

**OPEN DECISION:** exact fallback timeout and retry intervals. Implement configurable values and choose conservative documented defaults only after discussing them with the owner.

## 7. Retries and backoff

- Bounded retries; use exponential backoff with jitter for transient errors.
- Classify errors: transient, permanent, auth/configuration, rate limit, unknown.
- Permanent errors should not retry indefinitely.
- Respect provider retry-after hints.
- Add a maximum attempt count and dead-letter/needs-attention state.
- Alert the owner when retries are exhausted or configuration prevents fallback.
- Never retry a consequential external action with unknown outcome until reconciled. Reminder notifications may be retried only under the idempotency policy.

## 8. Webhook and duplicate handling

- Verify signatures.
- Store provider event ID and deduplicate.
- Make callback handling idempotent; the same callback may arrive multiple times or out of order.
- Use provider timestamps/status precedence rules where documented.
- Reject callbacks for unknown/unbound provider message IDs, but log a redacted diagnostic.
- Do not let a webhook directly authorize unrelated actions.

## 9. Scheduling semantics

- Store timestamps in UTC and user timezone separately.
- Daylight-saving behavior must be correct for users/timezones that observe DST; never assume every local day is 24 hours.
- For recurring reminders, persist recurrence rule and next occurrence.
- Generate next occurrence idempotently.
- Missed reminders after downtime should be reconciled: decide whether to send, summarize, or suppress stale notifications based on age and urgency. Make the policy configurable and visible.
- Use a fake clock in tests.
- Reminder processing must continue if all AI providers are down.

## 10. Quiet hours and focus blocks

- Quiet hours are configurable in user's local time.
- Focus blocks may suppress non-urgent interruptions but must not delete or lose the reminder.
- A suppressed reminder is rescheduled or surfaced in the next briefing according to policy.
- Urgent exception categories must be explicitly configured.
- Do not infer a medical, safety, or other urgent exception without a defined policy.

## 11. Monitoring metrics

- Due reminders not yet claimed.
- Queue/worker lag.
- Attempts per reminder.
- WhatsApp sent/delivered/failed/unknown rates.
- Email fallback rate and result.
- Time from due time to provider acceptance and delivery confirmation.
- Unknown outcomes older than threshold.
- Duplicate attempts prevented.
- Failed jobs and dead-letter count.
- Worker heartbeat and provider health.

## 12. Required scenarios

- API/model unavailable at reminder due time.
- Worker restarts before claim, after claim, after provider call, and after DB write.
- Provider timeout with unknown outcome.
- Duplicate/reordered webhook.
- WhatsApp explicit failure.
- WhatsApp remains unconfirmed and email fallback triggers.
- Email fallback provider unavailable.
- Missing/unverified email.
- Quiet hours/focus block.
- Reminder cancelled while queued.
- Recurring reminder completes once.
- Timezone/DST boundary.
- Database restore with overdue reminders.
- Two workers attempt to claim the same reminder.

No release until these tests pass or are explicitly classified as non-blocking with owner sign-off; core reminder-loss, duplicate, and fallback failures are always blockers.
