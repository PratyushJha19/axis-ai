# Workspace upgrade — implementation checklist

Status: foundation/Canvas MVP slice implemented and verified. See
[results](workspace-upgrade-results.md) for commands, evidence and remaining scope.

This is an incremental workspace milestone, preserving the existing authentication,
approval ledger, task statuses, notification adapters and PostgreSQL worker.

## Acceptance for this slice

- Project cards open a dedicated workspace with canonical tasks and project notes.
- Navigation and capture use progressive disclosure; project context is retained.
- Tasks with deadlines schedule durable reminders 24 and 12 hours beforehand.
  Only future offsets are created; edits invalidate obsolete queued alerts, and
  completed/cancelled/archived tasks cannot start new deadline delivery.
- Canvas MVP supports owned, persistent editable graphs, version checks, undo/redo,
  viewport persistence, explicit save failures and canonical references.
- Existing application behavior remains covered by regression checks.

## Decisions

Keep existing status names rather than introduce competing enums. Deadline offsets
are elapsed hours before the UTC deadline, not local calendar days. Existing tasks
are enrolled when next saved; migration does not broadcast a backlog. Delivery
uses existing channel consent, quiet hours, uncertainty handling and free-host
limitations. An already-started external send cannot be recalled.

The broader attachment additionally requests advanced planning, dependencies,
milestones, bulk workflows and AI canvas generation. Track and report any portions
not implemented rather than imply the whole specification is complete.
