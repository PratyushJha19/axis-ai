import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>) {
  await sql`
    create table users (
      id uuid primary key, google_subject text unique not null,
      email text not null, display_name text not null,
      timezone text, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table owner_binding (
      singleton boolean primary key default true check (singleton),
      user_id uuid unique not null references users(id)
    );
    create table sessions (sid varchar primary key, sess json not null, expire timestamptz not null);
    create index sessions_expire on sessions(expire);
    create table oauth_challenges (
      state_hash text primary key, expires_at timestamptz not null
    );
    create table projects (
      id uuid primary key, user_id uuid not null references users(id),
      name text not null check (length(name) between 1 and 120),
      description text not null default '', status text not null default 'active'
        check (status in ('active','paused','archived','completed')),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      version integer not null default 1, unique(user_id,id)
    );
    create index projects_owner on projects(user_id,created_at,id);
    create table tasks (
      id uuid primary key, user_id uuid not null references users(id), project_id uuid,
      title text not null check (length(title) between 1 and 200), description text not null default '',
      status text not null default 'inbox' check (status in ('inbox','planned','in_progress','blocked','completed','cancelled','deferred')),
      priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
      due_at timestamptz, due_timezone text, estimated_minutes integer check (estimated_minutes > 0),
      completion_at timestamptz, archived_at timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      version integer not null default 1, unique(user_id,id),
      foreign key (user_id,project_id) references projects(user_id,id),
      check ((due_at is null) = (due_timezone is null)),
      check ((status = 'completed') = (completion_at is not null))
    );
    create index tasks_owner_due on tasks(user_id,status,due_at,id);
    create table memory_items (
      id uuid primary key, user_id uuid not null references users(id), project_id uuid,
      content text not null check (length(content) between 1 and 10000),
      kind text not null check (kind in ('preference','fact','decision','context','routine','relationship','other')),
      scope text not null check (scope in ('global','project')),
      truth_status text not null check (truth_status in ('confirmed','assumed','suggested')),
      sensitivity text not null check (sensitivity in ('ordinary','sensitive')),
      save_consent_at timestamptz, source_type text not null default 'user' check (source_type = 'user'),
      archived_at timestamptz, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), version integer not null default 1,
      search_vector tsvector generated always as (to_tsvector('english', content)) stored,
      foreign key (user_id,project_id) references projects(user_id,id),
      check ((scope = 'project') = (project_id is not null)),
      check (sensitivity <> 'sensitive' or save_consent_at is not null)
    );
    create index memory_owner on memory_items(user_id,scope,project_id);
    create index memory_search on memory_items using gin(search_vector);
    create table task_events (
      id uuid primary key, user_id uuid not null references users(id), task_id uuid not null,
      event_type text not null, from_status text, to_status text,
      created_at timestamptz not null default now(),
      foreign key (user_id,task_id) references tasks(user_id,id) on delete cascade
    );
    create table audit_events (
      id uuid primary key, user_id uuid not null references users(id), event_type text not null,
      entity_id uuid, correlation_id uuid not null, created_at timestamptz not null default now()
    );
    create function prevent_audit_mutation() returns trigger language plpgsql as $$
      begin raise exception 'Audit records are append only'; end;
    $$;
    create trigger audit_immutable before update or delete on audit_events
      for each row execute function prevent_audit_mutation();
    create table request_keys (
      user_id uuid not null references users(id), key uuid not null, operation text not null,
      payload_hash text not null, entity_id uuid not null, created_at timestamptz not null default now(),
      primary key(user_id,key)
    );
    update foundation_metadata set schema_version = 2 where id = 1;
  `.execute(db);
}
