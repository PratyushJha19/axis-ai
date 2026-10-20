import { sql, type Kysely } from "kysely";
export async function up(db: Kysely<unknown>) {
  await sql`
create table calendar_connections(user_id uuid primary key references users(id),revision uuid not null,subject text not null,credential jsonb,scopes text[] not null,status text not null check(status in ('connected','syncing','temporary_failure','reauthorize','disconnected')),events jsonb not null default '[]',range_start timestamptz,range_end timestamptz,last_sync timestamptz,last_attempt timestamptz,retry_at timestamptz,lease uuid,lease_until timestamptz,error_code text,updated_at timestamptz not null default now());
create table calendar_challenges(state_hash text primary key,user_id uuid not null references users(id),session_hash text not null,challenge jsonb not null,expires_at timestamptz not null);
create index calendar_challenges_expiry on calendar_challenges(expires_at);
create table recovery_control(id integer primary key check(id=1),quarantined boolean not null default false);
insert into recovery_control(id) values(1);
update foundation_metadata set schema_version=12 where id=1;
`.execute(db);
}
