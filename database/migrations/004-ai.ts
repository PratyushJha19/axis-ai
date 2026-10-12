import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
export async function up(db: Kysely<Database>) {
  await sql`
    create table ai_configs (
      id uuid primary key, user_id uuid not null unique references users(id),
      provider text not null check(provider='groq'), model text not null,
      encrypted_key jsonb not null, version uuid not null,
      validation_status text not null default 'untested', validated_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table ai_conversations (
      id uuid primary key, user_id uuid not null references users(id),
      title text not null check(length(title)<=80), created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), unique(user_id,id)
    );
    create index ai_conversation_owner on ai_conversations(user_id,updated_at desc);
    create table ai_requests (
      id uuid not null, user_id uuid not null references users(id), conversation_id uuid not null,
      payload_hash text not null, status text not null check(status in ('pending','succeeded','failed','unknown')),
      error_code text, retryable boolean not null default false, attempts integer not null default 1 check(attempts between 1 and 3),
      include_context boolean not null, created_at timestamptz not null default now(), expires_at timestamptz not null,
      primary key(user_id,id), foreign key(user_id,conversation_id) references ai_conversations(user_id,id) on delete cascade
    );
    create index ai_pending on ai_requests(user_id,conversation_id) where status='pending';
    create table ai_messages (
      id uuid primary key, user_id uuid not null, conversation_id uuid not null, request_id uuid not null,
      role text not null check(role in ('user','assistant')), content text not null check(length(content) between 1 and 32000),
      provider text, model text, usage jsonb, created_at timestamptz not null default now(),
      unique(user_id,request_id,role),
      foreign key(user_id,conversation_id) references ai_conversations(user_id,id) on delete cascade,
      foreign key(user_id,request_id) references ai_requests(user_id,id) on delete cascade
    );
    create index ai_history on ai_messages(user_id,conversation_id,created_at);
    create table ai_rate_windows (user_id uuid primary key references users(id), window_at timestamptz not null, count integer not null);
    update foundation_metadata set schema_version=4 where id=1;
  `.execute(db);
}
