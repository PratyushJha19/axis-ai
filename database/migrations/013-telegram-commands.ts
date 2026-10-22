import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";

export async function up(db: Kysely<Database>) {
  await sql`
    create or replace function approval_digest(owner_id uuid, action_id uuid, body jsonb, policy text)
      returns text language sql immutable as $$
      select encode(sha256(convert_to(jsonb_build_object(
        'owner',owner_id,'action',action_id,'payload',body,'policy',policy,
        'application','axis','account',null,'risk','B','requires_approval',true,
        'type',(body->>'kind')||'.'||coalesce(body->'change'->>'operation','create'),
        'permission',(body->>'kind')||'s:'||case when body ? 'change' then 'update' else 'create' end
      )::text,'UTF8')),'hex') $$;
    create table telegram_commands (
      id uuid primary key default gen_random_uuid(), bot_id text not null, update_id bigint not null,
      user_id uuid not null references users(id), destination text not null, link_revision uuid not null,
      input text not null, status text not null default 'queued' check(status in ('queued','processing','done','unknown','suppressed')),
      lease_until timestamptz, created_at timestamptz not null default now(),
      unique(bot_id,update_id), unique(user_id,id)
    );
    create table telegram_command_replies (
      id uuid primary key references telegram_commands(id) on delete cascade,
      user_id uuid not null references users(id), bot_id text not null, destination text not null,
      link_revision uuid not null, body text not null, proposal_id uuid references ai_action_proposals(id),
      status text not null default 'queued' check(status in ('queued','sending','sent','unknown','failed','suppressed')),
      lease_until timestamptz, created_at timestamptz not null default now()
    );
    create table telegram_command_proposals (
      proposal_id uuid primary key references ai_action_proposals(id), user_id uuid not null references users(id),
      bot_id text not null, destination text not null, link_revision uuid not null
    );
    create index telegram_command_queue on telegram_commands(created_at) where status='queued';
    create index telegram_reply_queue on telegram_command_replies(created_at) where status='queued';
    update foundation_metadata set schema_version=13 where id=1;
  `.execute(db);
}
