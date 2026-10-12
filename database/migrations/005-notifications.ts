import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>) {
  await sql`
    alter table users add column email_verified_at timestamptz;
    create table notification_preferences (
      user_id uuid primary key references users(id),
      whatsapp_destination text check(whatsapp_destination ~ '^\\+[1-9][0-9]{7,14}$'),
      whatsapp_verified_at timestamptz, whatsapp_enabled boolean not null default false,
      whatsapp_window_until timestamptz,
      email_enabled boolean not null default false, email_destination text,
      fallback_enabled boolean not null default true,
      fallback_after_seconds integer not null default 300 check(fallback_after_seconds between 30 and 86400),
      revision uuid not null, updated_at timestamptz not null default now(),
      check(not whatsapp_enabled or (whatsapp_destination is not null and whatsapp_verified_at is not null)),
      check(not email_enabled or email_destination is not null)
    );
    create unique index notification_phone_owner on notification_preferences(whatsapp_destination) where whatsapp_verified_at is not null;
    create table notification_links (
      user_id uuid primary key references users(id), destination text not null,
      token_hash text not null unique, expires_at timestamptz not null
    );
    create table notification_jobs (
      id uuid primary key, user_id uuid not null references users(id), reminder_id uuid,
      occurrence integer, logical_key text not null,
      channel text not null check(channel in ('whatsapp','email')),
      provider text not null check(provider in ('twilio','resend')),
      kind text not null check(kind in ('reminder','test')),
      destination text, preference_revision uuid not null,
      status text not null default 'queued' check(status in ('queued','submitting','accepted','sent','delivered','read','retry_scheduled','failed','undelivered','unknown','suppressed','blocked')),
      fallback_of uuid references notification_jobs(id), fallback_deadline_at timestamptz,
      next_attempt_at timestamptz, attempt_count integer not null default 0,
      reconcile_count integer not null default 0,
      provider_message_id text, error_category text, attention boolean not null default false,
      lease_token uuid, lease_until timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      accepted_at timestamptz, delivered_at timestamptz,
      unique(logical_key,channel), unique(user_id,id),
      foreign key(user_id,reminder_id) references reminders(user_id,id),
      check((lease_token is null) = (lease_until is null)),
      check((kind='test' and reminder_id is null and occurrence is null) or (kind='reminder' and reminder_id is not null and occurrence is not null))
    );
    create unique index notification_provider_id on notification_jobs(provider,provider_message_id) where provider_message_id is not null;
    create index notification_jobs_due on notification_jobs(next_attempt_at,lease_until) where next_attempt_at is not null;
    create index notification_jobs_owner on notification_jobs(user_id,created_at,id);
    alter table notification_attempts drop constraint notification_attempts_channel_check;
    alter table notification_attempts drop constraint notification_attempts_provider_check;
    alter table notification_attempts drop constraint notification_attempts_status_check;
    alter table notification_attempts drop constraint notification_attempts_reminder_id_occurrence_attempt_number_key;
    alter table notification_attempts alter column reminder_id drop not null;
    alter table notification_attempts alter column occurrence drop not null;
    alter table notification_attempts alter column occurrence_due_at drop not null;
    alter table notification_attempts add column job_id uuid;
    alter table notification_attempts add foreign key(user_id,job_id) references notification_jobs(user_id,id);
    alter table notification_attempts add check(channel in ('mock','notification','whatsapp','email'));
    alter table notification_attempts add check(provider in ('mock','outbox','twilio','resend'));
    alter table notification_attempts add check(status in ('sending','sent','delivered','failed','unknown','suppressed','accepted','read','undelivered','blocked'));
    create unique index reminder_attempt_number on notification_attempts(reminder_id,occurrence,attempt_number) where job_id is null;
    create unique index delivery_attempt_number on notification_attempts(job_id,attempt_number) where job_id is not null;
    create table notification_events (
      provider text not null, event_id text not null, received_at timestamptz not null default now(),
      primary key(provider,event_id)
    );
    create table notification_rate_windows (
      scope text primary key, window_at timestamptz not null, count integer not null
    );
    alter table worker_heartbeats drop constraint worker_heartbeats_mode_check;
    alter table worker_heartbeats add check(mode in ('mock_only','live'));
    alter table reminders drop constraint reminders_channel_policy_check;
    alter table reminders add check(channel_policy in ('mock_only','whatsapp_email'));
    update foundation_metadata set schema_version=5 where id=1;
  `.execute(db);
}
