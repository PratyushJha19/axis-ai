import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>) {
  await sql`
create table planning_preferences(user_id uuid primary key references users(id),value jsonb not null,version integer not null default 1,updated_at timestamptz not null default now(),evaluated_at timestamptz not null default '2000-01-01');
create table plans(id uuid primary key,user_id uuid not null references users(id),document jsonb not null,status text not null default 'draft' check(status in ('draft','accepted','discarded')),version integer not null default 1,algorithm_version text not null default 'rank-v1',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),accepted_at timestamptz,unique(user_id,id));
create index plans_owner on plans(user_id,created_at desc,id);
create table planning_generations(id uuid primary key,user_id uuid not null references users(id),request_key uuid not null,request_hash text not null,fingerprint text not null,status text not null check(status in ('running','completed','failed','unknown')),result jsonb,expires_at timestamptz not null,created_at timestamptz not null default now(),unique(user_id,request_key));
create index planning_generation_owner on planning_generations(user_id,created_at desc);
create table planning_events(user_id uuid not null references users(id),event_key text not null,reminder_id uuid,source_task uuid,source_due timestamptz,created_at timestamptz not null default now(),primary key(user_id,event_key));
create index planning_event_reminder on planning_events(user_id,reminder_id);
create table planning_feedback(user_id uuid not null references users(id),task_id uuid not null,task_version integer not null,kind text not null check(kind in ('dismissed','not_useful')),primary key(user_id,task_id),foreign key(user_id,task_id) references tasks(user_id,id) on delete cascade);
update foundation_metadata set schema_version=11 where id=1;
`.execute(db);
}
