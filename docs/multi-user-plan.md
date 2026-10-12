# Multi-user accounts — scope and acceptance

Implementation and automated checks passed; see `multi-user-results.md`. Live two-account Google acceptance remains pending.

Owner decision, 2026-10-12: anyone with a verified Google account may sign up. This supersedes the single-owner onboarding restriction in M1/ADR-013 and the deferred onboarding boundary in M1.5/ADR-016.

Implement a focused multi-user milestone: reuse Google OIDC, PostgreSQL sessions and existing user-scoped records. Identify accounts exclusively by Google's verified subject; never merge by email. First sign-in creates a private workspace. Existing users retain IDs, data, keys and sessions. `OWNER_EMAIL` no longer gates login. Keep the historical `owner_binding` table without using it for authorization; no schema migration or destructive data rewrite is required.

Affected areas: authentication, setup script/env example, login UI, real two-session API/browser tests, and documentation. No team sharing, administrator access to private records, billing, deployment or real notification integration.

Acceptance: two distinct authenticated users create and revisit private workspaces; cannot read/edit/delete each other's projects/tasks/memory/reminders/chat/configuration; each uses their own AI key and timezone. Concurrent first login creates one account per subject. Email changes preserve subject identity; the same email with a different subject never grants access to old data. Unverified identities, CSRF violations and replayed/expired OAuth challenges remain denied. Logout affects only that session. Existing M1/M1.5/M2 checks pass. Live two-account Google verification remains a manual gate.
