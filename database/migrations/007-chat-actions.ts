import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
export async function up(db: Kysely<Database>) {
  await sql`
    create table ai_action_proposals (
      id uuid primary key, user_id uuid not null references users(id),
      conversation_id uuid not null, request_id uuid not null,
      payload jsonb not null, payload_hash text not null,
      status text not null default 'pending' check(status in ('pending','succeeded','rejected')),
      entity_id uuid, created_at timestamptz not null default now(),
      expires_at timestamptz not null default (now()+interval '24 hours'),
      unique(user_id,request_id),
      foreign key(user_id,conversation_id) references ai_conversations(user_id,id),
      foreign key(user_id,request_id) references ai_requests(user_id,id),
      check ((status='succeeded') = (entity_id is not null))
    );
    create index ai_action_history on ai_action_proposals(user_id,conversation_id,created_at);
    create function protect_ai_proposal() returns trigger language plpgsql as $$
    begin
      if new.id is distinct from old.id or new.user_id is distinct from old.user_id
        or new.conversation_id is distinct from old.conversation_id
        or new.request_id is distinct from old.request_id
        or new.payload is distinct from old.payload or new.payload_hash is distinct from old.payload_hash
        or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
        or old.status <> 'pending' then
        raise exception 'Immutable proposal';
      end if;
      return new;
    end $$;
    create trigger immutable_ai_proposal before update on ai_action_proposals for each row execute function protect_ai_proposal();
    update foundation_metadata set schema_version=7 where id=1;
  `.execute(db);
}
