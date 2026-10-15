# Settled Telegram reminder controls — 2026-10-16

Scope: M3 correctness fix, no new milestone or schema migration.

The screenshot showed a one-time reminder already sent to Telegram. Telegram
success remains `sent`, rather than inventing a delivery/read receipt. The UI
incorrectly offered edit, snooze and cancellation for that finished state, while
the backend described it as unresolved.

The shared settled-state predicate now recognizes `sent` + `telegram_sent`,
no recurrence, no next attempt and no attention flag. The UI hides those three
controls and explains that there are no future occurrences to cancel. The backend
returns the same explanation if a stale page attempts a change. Delivery evidence
is preserved. Scheduled recurring occurrences and unresolved sends keep the
existing cancellation/race rules. The outdated WhatsApp policy label is corrected.

Changed: `packages/shared/src/reminders.ts`, `packages/domain/src/reminders.ts`,
`apps/web/src/Reminders.tsx`, Telegram integration tests, reminder browser tests
and `docs/telegram-setup.md`.

Verified before continuation: formatting, lint, type checks and build passed;
34 unit/security tests passed after rerunning outside sandbox loopback restrictions;
all 68 database tests passed in isolated `axis_test_8835c8ca695e`, including the
settled Telegram cancellation response and preservation of sent evidence.

Browser verification uses a synthetic settled Telegram response. No live message
or existing reminder is modified. The first continuation attempt timed out while
PostgreSQL recovered from an earlier unclean shutdown; final browser outcome is
recorded below.

After recovery completed, `./scripts/verify-local.ps1 -Browser` passed all six
tests in isolated `axis_test_e2e_373f9a8f5d23`. The reminder browser test verified
scheduled cancellation, hidden edit/snooze/cancel controls for the synthetic
settled Telegram case, the explanatory text and corrected channel label.
Formatting checks passed for the changed files and this report. No database
migration or existing reminder modification was performed for this fix.

To apply the fix, restart the API via `npm run dev` to rebuild the dashboard.
No migration or reminder-data reset is required for this fix. Sent messages
cannot be recalled; creating a replacement reminder is a separate action.
