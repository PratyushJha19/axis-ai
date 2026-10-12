# AXIS — Database and Memory Design

**Version:** 1.0 | **Status:** Logical schema; exact ORM syntax is implementation-time

## 1. General data rules

- PostgreSQL is the source of truth.
- Use UUID primary keys unless the chosen ORM has a strong reason not to.
- Persist timestamps in UTC (`timestamptz`); store the user's IANA timezone (e.g. `Asia/Kolkata`) on the user profile.
- Add `created_at` and `updated_at` to mutable domain records.
- Use foreign keys, indexes, constraints, and migrations.
- Scope user-owned records by `user_id` even in single-user MVP.
- Use transactions for operations that must commit together.
- Do not store secrets, provider tokens, or raw authentication credentials in memory records.
- Use soft deletion/archive only when required for user recovery/audit; honor deletion requests and retention policy.

## 2. Logical entities

### users
- `id`
- `email` or provider subject, depending on auth design
- `display_name`
- `timezone`
- `quiet_hours_start`, `quiet_hours_end` (local wall-clock times; nullable until configured)
- `preferences_json`
- `created_at`, `updated_at`

### projects
- `id`, `user_id`
- `name`, `description`
- `status` (`active`, `paused`, `archived`, `completed`)
- `priority` (nullable)
- `start_date`, `target_date` (nullable)
- `metadata_json`
- `created_at`, `updated_at`, `archived_at`

### memory_items
- `id`, `user_id`, `project_id` nullable
- `kind` (preference, fact, decision, context, routine, relationship, other)
- `content` (text)
- `scope` (`global`, `project`)
- `truth_status` (`confirmed`, `assumed`, `suggested`)
- `confidence` (nullable numeric within 0–1)
- `source_type` (user, conversation, imported_file, integration, inferred)
- `source_ref` (nullable, sanitized reference)
- `sensitivity` (`ordinary`, `sensitive`)
- `save_consent_at` (nullable; required when policy says confirmation is needed)
- `valid_from`, `valid_until` (nullable)
- `archived_at`, `deleted_at` (nullable)
- `created_at`, `updated_at`, `last_accessed_at`

Indexes: `(user_id, scope, project_id)`, status/archive fields, created time, full-text search vector. Consider pgvector only after retrieval evaluation.

### tasks
- `id`, `user_id`, `project_id` nullable
- `title`, `description`
- `status` (`inbox`, `planned`, `in_progress`, `blocked`, `completed`, `cancelled`, `deferred`)
- `priority` (`low`, `normal`, `high`, `critical`)
- `due_at` nullable, `due_timezone` nullable
- `estimated_minutes` nullable
- `scheduled_start_at`, `scheduled_end_at` nullable
- `recurrence_rule` nullable
- `parent_task_id` nullable
- `source_channel` (`web`, `whatsapp`, `manual`, `integration`, `assistant`)
- `completion_at`, `archived_at` nullable
- `created_at`, `updated_at`

Constraints: scheduled end must be after start; estimate must be positive when present. Index `(user_id, status, due_at)` and project.

### task_dependencies
- `id`, `user_id`, `task_id`, `depends_on_task_id`
- `dependency_type` (initially `blocks`)
- `created_at`
- Prevent self-dependency and duplicate edges; detect cycles at service layer.

### task_events
- `id`, `user_id`, `task_id`
- `event_type`, `from_status`, `to_status`
- `metadata_json` with no unnecessary sensitive text
- `actor_type` (`user`, `assistant`, `system`)
- `created_at`

### time_blocks
- `id`, `user_id`, `task_id` nullable, `plan_id` nullable
- `title`, `start_at`, `end_at`, `timezone`
- `kind` (`fixed_commitment`, `focus`, `task`, `break`, `buffer`, `personal`)
- `status` (`proposed`, `accepted`, `completed`, `skipped`, `cancelled`)
- `source` (`user`, `planner`, `calendar_read`)
- `created_at`, `updated_at`
- Do not persist overlapping accepted blocks unless explicitly allowed (e.g. a block may be informational); validate overlap in service logic.

### plans
- `id`, `user_id`
- `period_start`, `period_end`
- `status` (`draft`, `proposed`, `accepted`, `superseded`, `archived`)
- `summary`, `constraints_json`
- `generated_by` (model/provider metadata, no prompt secrets)
- `created_at`, `updated_at`, `accepted_at`

### reminders
- `id`, `user_id`
- `task_id` nullable, `memory_item_id` nullable, `plan_id` nullable
- `title`, `body_template` (minimize sensitive content in notifications)
- `due_at`, `timezone`
- `status` (`scheduled`, `processing`, `sent`, `delivered`, `failed`, `unknown`, `cancelled`, `snoozed`)
- `channel_policy_json` (WhatsApp primary, email fallback; explicit config)
- `fallback_after_at` nullable
- `next_attempt_at` nullable
- `last_attempt_at` nullable
- `idempotency_key` unique per logical notification
- `created_by`, `created_at`, `updated_at`, `cancelled_at`

### notification_attempts
- `id`, `user_id`, `reminder_id`
- `channel` (`whatsapp`, `email`)
- `provider`
- `status` (`queued`, `sending`, `sent`, `delivered`, `failed`, `unknown`, `suppressed`)
- `attempt_number`
- `provider_message_id` nullable
- `idempotency_key`
- `started_at`, `finished_at` nullable
- `error_code`, `error_category`, `error_summary` (redacted)
- `provider_status_at` nullable
- `created_at`
- Unique constraint on provider/channel idempotency tuple where supported.

### action_proposals
- `id`, `user_id`
- `action_type`
- `title`, `description`
- `destination_summary`
- `payload_json` (validated, immutable after proposal)
- `payload_hash`
- `risk_level` (`low`, `medium`, `high`, `critical`)
- `status` (`draft`, `pending_approval`, `approved`, `rejected`, `expired`, `executing`, `succeeded`, `failed`, `unknown`, `cancelled`)
- `expires_at` (default 24h after approval request)
- `approved_at`, `approved_by` nullable
- `executed_at`, `result_summary` nullable
- `idempotency_key`
- `created_at`, `updated_at`

### approval_events
- `id`, `user_id`, `action_proposal_id`
- `event_type` (`requested`, `approved`, `rejected`, `expired`, `execution_started`, `execution_succeeded`, `execution_failed`, `execution_unknown`, `revoked`)
- `actor_type`, `actor_ref` nullable
- `payload_hash`
- `metadata_json` redacted
- `created_at`

### integrations
- `id`, `user_id`
- `provider`, `integration_type`
- `status` (`disconnected`, `pending`, `connected`, `degraded`, `revoked`, `error`)
- `external_account_ref` nullable
- `scopes_json`
- `secret_reference` (reference to secret store, never raw secret)
- `last_checked_at`, `last_error_summary` nullable
- `created_at`, `updated_at`, `revoked_at`

### audit_events
- `id`, `user_id`
- `event_type`, `actor_type`, `actor_ref` nullable
- `entity_type`, `entity_id` nullable
- `correlation_id`
- `outcome`
- `metadata_json` (allow-listed, redacted)
- `created_at`
- Append-only from application code; restrict update/delete permissions.

### conversations and messages (optional for MVP)
- `conversations`: `id`, `user_id`, `channel`, `status`, timestamps.
- `messages`: `id`, `conversation_id`, `direction`, `provider_message_id`, `content` or encrypted/redacted representation, `received_at`, `processed_at`, `status`.
- Keep retention configurable. Do not treat message history as the only source of memory.

### system_jobs / worker_leases (implementation choice)
A durable queue table or a reminder-driven claim strategy may be used. It must support atomic claiming, lease expiry, attempts, next retry, and deduplication. Document chosen approach.

## 3. Memory behavior

### Save policy
- Routine/non-sensitive user-provided information: save by default when useful and relevant.
- Sensitive/personal information: ask before saving.
- Credentials/secrets: never save as ordinary memory.
- Inferred details: mark `assumed` or `suggested`; do not present as confirmed.
- Keep source/provenance and confidence where feasible.

### Retrieval policy
- Search global memory plus relevant active project memory.
- Include archived project memory when relevant, clearly labeled archived.
- Filter deleted records.
- Prefer confirmed, current records over stale assumptions.
- When facts conflict, show the conflict and ask for correction rather than silently choosing.
- Do not infer that absence from memory means a fact is false.
- Retrieval should return source/updated time to the assistant so it can explain why it believes something.

### Correction and deletion
- Correction should update the current record and preserve a minimal audit event without retaining deleted sensitive content.
- Deletion should prevent normal retrieval immediately. Any retention exceptions must be documented and limited.
- Offer a user-facing memory browser with search and filters by scope/type/status.
- Export is desirable but not an MVP release blocker.

## 4. Transactions and consistency

- Creating a task and its reminder should be transactional when both are confirmed in one operation.
- Approval status change and creation of execution job must be atomic.
- Worker claim and attempt record must prevent concurrent duplicate processing.
- Webhook updates must be idempotent.
- Task completion and recurring next-occurrence creation must be idempotent.
- Never rely only on in-process memory for pending jobs.

## 5. Migration and indexing checklist

- Include indexes for all frequent user-scoped list/search paths.
- Add database constraints for valid enum-like values and date ranges.
- Test migrations from an empty database and from the previous schema version.
- Seed only synthetic sample data.
- Do not put real personal memory or credentials in seed files.
