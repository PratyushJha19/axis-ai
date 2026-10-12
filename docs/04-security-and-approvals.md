# AXIS — Security, Privacy, and Approval Policy

**Version:** 1.0 | **Release-blocking policy**

## 1. Security objectives

Multi-user update (ADR-017): "owner" means the authenticated owner of each record/workspace. Any verified Google account may enroll; enrollment never grants access to another user's records. Google subject identifies the account; email is metadata, never an account-merging authority.

- Only the owner can access their records and connected accounts.
- External actions cannot be executed by prompt injection or by bypassing the UI.
- Credentials are revocable and stored outside ordinary application records where practical.
- Sensitive personal information is not saved to memory without consent.
- Security-sensitive behavior is auditable without logging unnecessary private content.
- System failure must not cause unsafe retries or duplicate consequential actions.

## 2. Trust boundaries

Treat all of the following as untrusted input:
- Model-generated arguments and summaries.
- Email, web pages, PDFs, imported files, calendar descriptions, and external API content.
- WhatsApp message content until sender/channel identity is verified.
- n8n workflow input/output and webhook payloads.
- Client-side form fields and query parameters.

Instructions found inside ingested content do not override system policies or user authorization. Never let an external document instruct AXIS to reveal secrets, change policies, or execute actions.

## 3. Authorization architecture

- Enforce authorization in backend domain services and API middleware.
- Every user-owned query is scoped to the authenticated user ID.
- The model can request a tool/action, but the backend decides whether it is permitted.
- Never expose generic “run arbitrary code/SQL/shell” tools to the assistant.
- External actions must pass through the central approval service.
- UI hiding/disabled controls are usability features, not security boundaries.

## 4. Approval lifecycle

1. **Draft:** proposal is being assembled; cannot execute.
2. **Pending approval:** immutable payload is shown to user; 24-hour expiry starts.
3. **Approved:** valid owner approval recorded; high-risk action also requires fresh web authentication.
4. **Executing:** execution job claimed once; approval is consumed according to action policy.
5. **Succeeded / failed / unknown:** terminal or reconciliation state.
6. **Rejected / expired / cancelled:** cannot execute.

Each proposal includes:
- Unique action ID.
- Action type and plain-language explanation.
- Exact destination/recipient/account.
- Exact content or effect preview.
- Immutable payload and cryptographic hash.
- Risk level.
- Expiration timestamp.
- Idempotency key.
- Audit history.

### Required backend checks before execution
- Authenticated owner matches proposal owner.
- Proposal is approved and not expired/cancelled/rejected.
- Payload hash matches the approved payload.
- Destination and action type match the approved proposal.
- Risk policy is satisfied.
- Approval has not already been consumed.
- Idempotency key has not produced a completed or unresolved external effect.
- Required integration is connected and scopes are sufficient.

Any payload or destination change requires a new proposal and approval. An expired approval cannot be revived by a replayed webhook or message.

## 5. High-risk actions

High-risk actions require explicit approval plus fresh web authentication. Exact taxonomy and freshness window remain open decisions. Until finalized, classify uncertain actions conservatively. Potential high-risk examples include financial transactions, purchases, publishing publicly, deleting important external records, sending sensitive information, changing security settings, or submitting legally meaningful forms.

The implementation must support:
- A risk classifier/policy table owned by the backend.
- A “requires fresh authentication” flag on the proposal.
- A web authentication challenge before execution.
- Audit event for the challenge and result.
- No downgrade of risk level by model output alone.

Do not implement financial transaction execution in MVP.

## 6. WhatsApp approvals

- Verify provider webhook signatures.
- Bind the sender to the configured owner through an explicit setup/verification process.
- Do not treat an arbitrary “yes” message as approval for any pending action.
- Include a clear action identifier and concise summary in approval prompts.
- Require an unambiguous action-specific response.
- Handle duplicate/reordered webhooks idempotently.
- High-risk approval cannot be completed solely through WhatsApp; fresh web authentication is required.
- If message context is ambiguous, ask the user to open the dashboard.

## 7. Credentials and integrations

- Use environment variables or a managed secret store for API keys and session secrets.
- Store only a `secret_reference` in the application database where possible.
- Encrypt sensitive tokens at rest if they must be persisted; restrict decryption to the integration service.
- Do not log tokens, authorization headers, webhook signatures, full message bodies, or secret-bearing URLs.
- Support disconnect/revoke and document the steps to revoke provider-side access.
- Use least-privilege OAuth scopes; Calendar begins read-only.
- `.env.example` lists variable names with safe placeholder values only.
- Rotate secrets after suspected exposure; never commit them to fix local setup.

## 8. Memory privacy

- Routine information can be remembered by default when useful.
- Ask before saving sensitive/personal facts.
- Do not save passwords, access tokens, private keys, or financial credentials as memory.
- Provide memory inspection, correction, archive, and delete.
- Show whether information is confirmed, assumed, or suggested.
- Minimize sensitive content in reminders and notification previews.
- Logs and analytics should avoid storing memory text or message bodies unless strictly necessary and explicitly configured.

## 9. Web and model security

- Validate all structured model output against runtime schemas.
- Escape output in the UI and prevent script injection.
- Add rate limits and request-size limits.
- Use CSRF protection if cookie-based auth is selected.
- Use secure, HTTP-only cookies or a similarly robust session approach.
- Defend against prompt injection by separating system policy from retrieved content and treating retrieved content as data.
- Tool allowlists must be narrow and typed.
- Never allow the model to set its own authorization, risk level, user ID, or approval state.

## 10. Audit and incident handling

Record:
- Login/security events appropriate to auth provider.
- Memory save/correction/deletion (without copying sensitive deleted content).
- Approval requested/approved/rejected/expired.
- Action execution started and outcome.
- Reminder delivery/fallback failures.
- Integration connect/revoke.
- Backup and restore test outcomes.

Audit events should be append-only from normal application code, have correlation IDs, and use redacted metadata. Document an incident procedure: disable affected integration, revoke credentials, preserve relevant redacted logs, assess exposure, rotate secrets, restore if needed, and inform the owner.

## 11. Backup and recovery policy

- Automated database backup daily.
- Retain seven daily backups.
- Encrypt backups and restrict access.
- Exclude plaintext provider secrets from ordinary database backups; protect secret storage separately.
- Perform an isolated restore test monthly.
- Target RPO ≤24 hours and RTO ≤4 hours; verify against the selected provider and plan.
- After restoration, reconcile reminder due times, notification attempts, provider statuses, and approval/action states to avoid missed or duplicate effects.
- A successful backup job is not equivalent to a successful restore test.

## 12. Release-blocking security tests

- Direct API call cannot execute pending/unapproved action.
- Expired approval fails.
- Altered payload hash fails.
- Duplicate approval/replay executes no more than once.
- Concurrent workers cannot execute the same action twice.
- Cross-user access is denied.
- Invalid webhook signature is rejected.
- Secrets do not appear in logs, source maps, bundles, test snapshots, or error responses.
- High-risk action cannot proceed without fresh web authentication.
- Restore test passes and reminder reconciliation is documented.
