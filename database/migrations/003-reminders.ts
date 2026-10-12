import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>) {
  await sql`
    create table reminder_preferences (
      user_id uuid primary key references users(id),
      quiet_start text, quiet_end text, focus_blocks jsonb not null default '[]',
      version integer not null default 1, updated_at timestamptz not null default now(),
      check ((quiet_start is null) = (quiet_end is null)),
      check (quiet_start is null or (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        and quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and quiet_start <> quiet_end)),
      check (jsonb_typeof(focus_blocks) = 'array')
    );
    create table reminders (
      id uuid primary key, user_id uuid not null references users(id),
      title text not null check (length(title) between 1 and 200),
      body text not null default '' check (length(body) <= 1000),
      task_id uuid, project_id uuid, due_at timestamptz not null,
      local_due text not null, timezone text not null,
      recurrence text not null check (recurrence in ('none','daily','weekly')),
      disambiguation text not null check (disambiguation in ('reject','earlier','later')),
      status text not null default 'scheduled' check (status in ('scheduled','processing','sent','delivered','failed','unknown','cancelled','snoozed')),
      channel_policy text not null default 'mock_only' check (channel_policy='mock_only'),
      occurrence integer not null default 1 check (occurrence > 0),
      skipped_count integer not null default 0 check (skipped_count >= 0),
      send_count integer not null default 0 check (send_count >= 0),
      reconcile_count integer not null default 0 check (reconcile_count >= 0),
      next_attempt_at timestamptz, last_attempt_at timestamptz,
      lease_token uuid, lease_until timestamptz,
      attention boolean not null default false, reason text,
      idempotency_key uuid not null unique, correlation_id uuid not null,
      version integer not null default 1 check (version > 0), cancelled_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (user_id,id), foreign key (user_id,task_id) references tasks(user_id,id),
      foreign key (user_id,project_id) references projects(user_id,id),
      check ((lease_token is null) = (lease_until is null)),
      check ((status='cancelled') = (cancelled_at is not null))
    );
    create index reminders_due on reminders(next_attempt_at,lease_until) where next_attempt_at is not null;
    create index reminders_owner on reminders(user_id,created_at,id);
    create table notification_attempts (
      id uuid primary key, user_id uuid not null, reminder_id uuid not null,
      occurrence integer not null check (occurrence > 0), occurrence_due_at timestamptz not null,
      channel text not null default 'mock' check (channel='mock'),
      provider text not null default 'mock' check (provider='mock'),
      status text not null check (status in ('sending','sent','delivered','failed','unknown','suppressed')),
      attempt_number integer not null check (attempt_number > 0), idempotency_key text not null,
      provider_message_id text, error_category text,
      started_at timestamptz not null, finished_at timestamptz,
      foreign key(user_id,reminder_id) references reminders(user_id,id),
      unique(reminder_id,occurrence,attempt_number)
    );
    create index attempts_owner on notification_attempts(user_id,reminder_id,started_at,id);
    create table mock_notification_receipts (
      idempotency_key text primary key, provider_message_id uuid not null unique,
      created_at timestamptz not null default now()
    );
    create table worker_heartbeats (
      id uuid primary key, last_seen_at timestamptz not null,
      mode text not null check(mode='mock_only')
    );
    update foundation_metadata set schema_version=3 where id=1;
  `.execute(db);
}
