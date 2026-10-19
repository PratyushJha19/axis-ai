import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";

export async function up(db: Kysely<Database>) {
  await sql`
    alter table ai_action_proposals alter column conversation_id drop not null;
    alter table ai_action_proposals alter column request_id drop not null;
    alter table ai_action_proposals add column policy_version text not null default 'm4-internal-v1';
    alter table ai_action_proposals add column approved_at timestamptz;
    alter table ai_action_proposals add column execution_started_at timestamptz;
    alter table ai_action_proposals add column finished_at timestamptz;
    alter table ai_action_proposals add column failure_code text;
    alter table ai_action_proposals add column idempotency_key uuid;
    create function approval_digest(owner_id uuid, action_id uuid, body jsonb, policy text)
      returns text language sql immutable as $$
      select encode(sha256(convert_to(jsonb_build_object(
        'owner',owner_id,'action',action_id,'payload',body,'policy',policy,
        'application','axis','account',null,'risk','B','requires_approval',true,
        'type',(body->>'kind')||'.create','permission',(body->>'kind')||'s:create'
      )::text,'UTF8')),'hex') $$;
    alter table ai_action_proposals add column context_hash text not null default '';
    drop trigger immutable_ai_proposal on ai_action_proposals;
    update ai_action_proposals set context_hash=approval_digest(user_id,id,payload,policy_version),idempotency_key=id;
    alter table ai_action_proposals alter column idempotency_key set not null;
    alter table ai_action_proposals alter column idempotency_key set default gen_random_uuid();
    create unique index approval_idempotency on ai_action_proposals(user_id,idempotency_key);
    create function initialize_approval_digest() returns trigger language plpgsql as $$
    begin
      new.context_hash := approval_digest(new.user_id,new.id,new.payload,new.policy_version);
      return new;
    end $$;
    create trigger initialize_approval before insert on ai_action_proposals
      for each row execute function initialize_approval_digest();
    alter table ai_action_proposals drop constraint ai_action_proposals_status_check;
    alter table ai_action_proposals add constraint ai_action_proposals_status_check
      check(status in ('pending','approved','executing','succeeded','rejected','expired','cancelled','failed','unknown'));
    create or replace function protect_ai_proposal() returns trigger language plpgsql as $$
    begin
      if new.id is distinct from old.id or new.user_id is distinct from old.user_id
        or new.conversation_id is distinct from old.conversation_id
        or new.request_id is distinct from old.request_id
        or new.payload is distinct from old.payload or new.payload_hash is distinct from old.payload_hash
        or new.policy_version is distinct from old.policy_version
        or new.context_hash is distinct from old.context_hash
        or new.idempotency_key is distinct from old.idempotency_key
        or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at
        or not (
          (old.status='pending' and new.status in ('approved','rejected','expired','cancelled'))
          or (old.status='approved' and new.status in ('executing','expired','cancelled'))
          or (old.status='executing' and new.status in ('succeeded','failed','unknown'))
        ) then raise exception 'Immutable proposal or invalid transition'; end if;
      if old.approved_at is not null and new.approved_at is distinct from old.approved_at
        then raise exception 'Immutable approval'; end if;
      return new;
    end $$;
    create trigger immutable_ai_proposal before update on ai_action_proposals
      for each row execute function protect_ai_proposal();
    create index approval_inbox on ai_action_proposals(user_id,created_at desc,id);
    update foundation_metadata set schema_version=9 where id=1;
  `.execute(db);
}
