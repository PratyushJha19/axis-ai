# AXIS — UI/UX Specification

**Version:** 1.0 | **Visual direction:** Premium, futuristic, calm command center

## 1. Experience principles

- Dark mode by default; optional light mode.
- Premium futuristic/JARVIS-inspired without excessive glow, animation, or visual noise.
- Clear typography and generous spacing; information-dense but not overwhelming.
- Concise, natural, intelligent assistant voice with slight wit when appropriate.
- Status, deadlines, risk, and next action must be more prominent than decoration.
- Accessible keyboard navigation, contrast, focus indicators, reduced-motion support, and responsive layouts.
- Do not use color alone to communicate status.

## 2. Global shell

### Desktop
- Left sidebar: Home, Tasks, Projects, Memory, Calendar/Plan, Inbox/Approvals, Integrations, Settings.
- Main workspace: current section.
- Persistent assistant panel or expandable assistant surface.
- Top-level quick capture always accessible.
- Notification/system health indicators.
- Clear connected-account status and profile/settings access.

### Mobile
- Chat-first default with a simple bottom or compact navigation.
- Quick capture available immediately.
- Easy access to today's agenda, reminders, approvals, and tasks.
- Avoid desktop-style three-column layouts on narrow screens.
- Keep approval summaries readable and require deliberate confirmation.

## 3. Dashboard / Home

Required cards/sections:
1. **Today:** fixed commitments, due tasks, reminder status.
2. **Top priorities:** limited, ranked list with reason.
3. **Deadlines:** upcoming and overdue commitments.
4. **Pending approvals:** count and clear next action.
5. **Daily briefing:** concise summary, risks, suggested focus.
6. **Plan:** today's time blocks with rest and buffers.
7. **Projects:** active project health and next milestones.
8. **Inbox / delivery health:** failed or unknown reminders, integration issues.
9. **Quick capture:** task, memory, reminder, or general note.
10. **Recent memory/activity:** small, searchable trail.

Allow hiding/reordering lower-priority widgets later; do not make customization a prerequisite for MVP.

## 4. Tasks

- Views: Today, Upcoming, Overdue, Inbox, Completed, project filter.
- Show status, priority, due date/time, project, estimated effort, dependencies.
- Actions: complete, edit, defer, reschedule, archive.
- Make overdue items actionable without shaming the user.
- When rescheduling a missed task, show a proposal and ask before changing the plan.
- Recurring task completion should clearly show the next occurrence.

## 5. Memory

- Searchable list with filters for global/project, type, confirmed/assumed/suggested, active/archived.
- Memory detail shows content, provenance/source, last updated, confidence/status, and project scope.
- Actions: correct, archive, delete.
- For sensitive facts, display consent state and avoid accidental exposure in notifications.
- Deletion confirmation should be proportionate; do not make correction/deletion difficult.

## 6. Inbox and approvals

- Separate actionable approvals from informational alerts.
- Each approval card shows action, exact recipient/destination, concise preview, risk, expiry, and consequences.
- Actions: approve, reject, inspect details.
- High-risk action requires web re-authentication at approval/execution boundary.
- Do not use vague buttons such as “OK” for consequential actions; use explicit labels such as “Approve sending email.”
- Display expired proposals as expired and require a fresh proposal.
- Show execution result as succeeded, failed, or unknown; never imply success while unknown.

## 7. Reminder detail

Show:
- Title and linked task/project.
- Due date/time and timezone.
- Channel policy.
- Status and delivery attempts.
- WhatsApp provider status and email fallback status.
- Last attempt, next retry, error summary (redacted).
- Edit, snooze, cancel actions.

Use plain-language status labels such as “Sent; delivery not confirmed” rather than misleading “Delivered.”

## 8. Assistant interaction

- Keep responses concise by default.
- Distinguish facts, assumptions, and suggestions.
- For proposed changes, show a compact structured summary before confirmation.
- Ask a single direct question when one essential detail is missing.
- Never claim a record was saved/scheduled until backend confirms persistence.
- Explain uncertainty and next step, not internal stack traces.
- Provide undo/cancel where safe and technically possible.
- Assistant should not create clutter by narrating every internal step.

## 9. Planning/calendar

- Day and week views.
- Fixed commitments visually distinct from flexible tasks and breaks.
- Show buffers and overload warnings.
- Plans are proposals until accepted.
- Calendar imported in read-only mode initially.
- If a plan cannot fit, explain the conflict and offer options rather than overbooking.
- Timezone must be visible when ambiguity is possible.

## 10. Integrations/settings

- Connection status, last successful check, permissions/scopes, disconnect/revoke.
- Clear environment indicator for sandbox vs production.
- Never display full secrets after saving.
- Configure timezone, quiet hours, notification channels, email fallback, briefing time, and model/provider budget.
- Explain which data each integration can read/write.

## 11. Visual tokens (initial guidance)

The coding agent may refine these after a small prototype:
- Base: near-black/charcoal background, layered neutral surfaces.
- Accent: restrained electric blue or cool cyan.
- Secondary accents: muted slate; reserve amber/red for attention/error.
- Corners: moderately rounded, not pill-shaped everywhere.
- Motion: subtle transitions; no distracting constant animations.
- Use clear type scale and consistent spacing.
- Avoid excessive gradients, neon borders, and sci-fi clichés.

## 12. Accessibility and responsive acceptance

- Keyboard can reach all actions and dialogs.
- Focus is visible.
- Contrast is sufficient.
- Screen reader labels exist for icon-only actions.
- Dialogs manage focus correctly.
- Layout works at narrow mobile widths and desktop widths.
- Reduced motion preference is respected.
- Approval actions are not dangerously adjacent without confirmation.
