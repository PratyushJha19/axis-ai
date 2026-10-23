# Workspace foundation and Canvas MVP

## Implemented

- Project cards open their canonical task list, Notes and Canvas tabs. Project
  settings remain explicit. New project creation opens the workspace, and its
  task/note capture preselects the project.
- The assistant dock starts closed, task notes are collapsed under Notes and
  context, and project pages use one project heading. Global status/overdue task
  filters run in PostgreSQL before pagination.
- Deadline entry uses the profile IANA timezone, rejecting nonexistent/ambiguous
  DST wall times. Dated tasks default to persistent 24-hour and 12-hour alerts.
  The checkbox disables these offsets. Title-only capture remains valid.
- Canvas supports blank and six editable starting templates, nodes, connections,
  relationship labels, move/resize, duplicate node, search highlighting, pan/zoom,
  minimap, fit view, session undo/redo, autosave and viewport persistence.
- Canvas data is owner-scoped, runtime validated, limited to 100 nodes/200 edges
  and 256 KB requests. Conflicts retain the draft and expose download/reload
  recovery; browser/page navigation warns about unsaved edits.
- Convert a node to a canonical task with explicit confirmation, then edit the
  task's deadline/priority in the standard editor. Repeat conversion returns the
  same linked task. Detaching/removing nodes and deleting canvases keep tasks.
  Linked task titles/status come from the canonical record; node notes stay visual.

## Migration and code

`014-workspaces.ts` adds `tasks.deadline_reminders`, the durable
`task_deadline_alerts` source ledger, the task schedule trigger, `canvases`,
`canvas_nodes`, and `canvas_edges`. Existing task rows are preserved and enrolled
only when next saved. Past offsets are skipped; a task due in 18 hours gets only
the future 12-hour alert. Ordinary edits do not recreate cancelled/expired alerts.
Reopening or explicitly re-enabling future alerts can re-enrol cancelled offsets.

Main changes: `apps/web/src/{App,ProjectWorkspace,Canvas,CanvasLoader}.tsx`, shared
Canvas/task contracts, `packages/domain/src/{canvas,records,task-deadline-policy}.ts`,
API Canvas routes, both notification worker dispatch guards, migration readiness
and backup schema compatibility. No production migration or deployment was run.

API: authenticated `GET /api/v1/canvases`, `GET/PUT/DELETE /api/v1/canvases/:id`,
and `POST /api/v1/canvases/:id/nodes/:node/task`. Writes require session/CSRF;
updates/deletion/conversion require `If-Match`. Graph relationships are visual only
and do not bypass the approval ledger.

## Run locally

After installing dependencies (`npm ci`), run `npm run dev`. This starts/checks
local PostgreSQL, applies migrations, builds the web app and starts the API at
http://localhost:3000. In a second terminal run `npm run dev:worker` for reminder
processing. Keep the existing notification channel configuration and consent.
No new environment variables are required. Existing mock/live settings still
apply. Use mock mode for testing; this work did not send any live notifications.

Existing deployed builds need the new code/build and schema migration before
these features appear. Free Render sleep can delay alerts; these offsets are
scheduled times, not a promise of punctual delivery. Quiet hours/focus blocks
also defer delivery. Delivery status remains in Reminders/Notifications.

## Verification

- `npm run check`: passed formatting, ESLint, both TypeScript checks and all
  **56 unit/security tests**. The initial sandbox run blocked localhost sockets;
  the unrestricted local test run passed.
- `powershell.exe -NoProfile -File scripts/verify-local.ps1`: **126 passed** in
  isolated database `axis_test_9d623848225b`. Includes clean migration, upgrade,
  restart/recovery, backup/restore, owner isolation, concurrent Canvas conversion,
  deadline offsets, cancellation/source invalidation, opt-out preservation,
  queued channel suppression, reopening and deletion tombstones.
- Browser regression: **13 workflows passed** across the full regression run
  and focused workspace rerun. The final command was
  `powershell.exe -NoProfile -File scripts/verify-local.ps1 -Browser -Spec workspace.spec.ts`,
  using `axis_test_e2e_08349ffecef0`. It covers project-scoped capture, deadline
  alerts, graph autosave, simulated save failure/retry, undo/redo, canonical task
  conversion/title refresh, persistence and mobile overflow. The expanded check
  exposed and verified a fix for false unsaved warnings caused by server row order.
- Local PostgreSQL needed recovery beyond the test runner's startup timeout;
  `scripts/start-local-postgres.ps1` waited successfully. No cluster reset was used.
- `npm run typecheck` passed again after the final Canvas save-state correction.
- `npm run build`: passed; Canvas is a separate lazy-loaded chunk. Vite still
  warns about the main bundle exceeding 500 KB.
- `npm audit --json`: no high/critical advisories; one moderate transitive
  `ip-address` advisory remains. No broad dependency upgrade was applied.
- `git diff --check`: passed. Generated desktop Canvas screenshot was inspected.

## Remaining scope and limitations

The broader upgrade is **not complete**. Still pending: canonical milestones and
roadmap/schedule sections; subtask/dependency cycles and workstreams; Kanban/bulk
task actions; richer project progress metrics; expanded Today/Planning; AI graph
draft generation and bulk previews; recurring tasks; Canvas copy/paste, canvas
duplication/project reassignment UI, existing-task picker and milestone conversion.
Visual Milestone nodes are not canonical milestones. Conversion currently confirms
title/notes/project first and opens the task editor for additional fields afterwards.

Canvas undo/redo is session-local, not server history or collaborative merging.
If a task disappears, its node remains and the reference clears; network failures
show a linked-task-unavailable label. Task rows linked to manually-created reminders
retain the existing deletion restrictions. Existing tasks require a save to enroll
deadline offsets. Deployment/live Telegram acceptance remains an operator step.
