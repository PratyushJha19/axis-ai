import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>) {
  await sql`
    alter table notification_preferences add column telegram_destination text;
    alter table notification_preferences add column telegram_bot_id text;
    alter table notification_preferences add column telegram_verified_at timestamptz;
    alter table notification_preferences add column telegram_enabled boolean not null default false;
    alter table notification_preferences alter column fallback_enabled set default false;
    alter table notification_preferences add check(not telegram_enabled or (telegram_destination is not null and telegram_bot_id is not null and telegram_verified_at is not null));
    create unique index notification_telegram_owner on notification_preferences(telegram_bot_id,telegram_destination) where telegram_verified_at is not null;
    create table telegram_links(user_id uuid primary key references users(id), bot_id text not null, token_hash text unique not null, expires_at timestamptz not null);
    create table telegram_poll_state(bot_id text primary key, next_offset bigint not null default 0, lease_token uuid, lease_until timestamptz, last_success_at timestamptz);
    alter table notification_jobs add column telegram_bot_id text;
    alter table notification_jobs drop constraint notification_jobs_channel_check;
    alter table notification_jobs add check(channel in ('whatsapp','email','telegram'));
    alter table notification_jobs drop constraint notification_jobs_provider_check;
    alter table notification_jobs add check(provider in ('twilio','resend','telegram'));
    alter table notification_attempts drop constraint notification_attempts_channel_check;
    alter table notification_attempts add check(channel in ('mock','notification','whatsapp','email','telegram'));
    alter table notification_attempts drop constraint notification_attempts_provider_check;
    alter table notification_attempts add check(provider in ('mock','outbox','twilio','resend','telegram'));
    update notification_preferences set whatsapp_enabled=false, fallback_enabled=false;
    update notification_jobs set status=case when status in ('queued','retry_scheduled') then 'blocked' when status='submitting' then 'unknown' else status end,
      attention=true,error_category='legacy_whatsapp_retired',next_attempt_at=null,fallback_deadline_at=null,lease_token=null,lease_until=null
      where channel='whatsapp' and status not in ('delivered','read','suppressed');
    update foundation_metadata set schema_version=6 where id=1;
  `.execute(db);
}
