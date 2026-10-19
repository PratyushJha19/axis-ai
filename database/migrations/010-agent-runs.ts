import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
export async function up(db: Kysely<Database>) {
  await sql`
    alter table ai_action_proposals add constraint approval_owner_id unique(user_id,id);
    create table agent_runs (
      id uuid primary key, user_id uuid not null references users(id),
      conversation_id uuid, idempotency_key uuid not null, input_hash text not null,
      goal text not null check(length(goal)<=4000),
      status text not null default 'queued' check(status in ('queued','running','waiting_for_approval','waiting_for_user','completed','failed','cancelled','timed_out')),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      deadline_at timestamptz not null default(now()+interval '25 hours'),
      lease_token uuid, lease_until timestamptz,
      iterations integer not null default 0, tool_count integer not null default 0,
      usage_tokens integer not null default 0,
      transcript jsonb not null default '[]', pending_decision jsonb,
      waiting_for_proposal_id uuid, answer text, error_code text,
      unique(user_id,id), unique(user_id,idempotency_key),
      foreign key(user_id,conversation_id) references ai_conversations(user_id,id),
      foreign key(user_id,waiting_for_proposal_id) references ai_action_proposals(user_id,id)
    );
    create index agent_queue on agent_runs(status,created_at);
    create table agent_tool_calls (
      id uuid primary key, user_id uuid not null, agent_run_id uuid not null,
      step integer not null, tool_id text not null, arguments jsonb not null,
      status text not null check(status in ('completed','waiting_for_approval','failed','cancelled')),
      result jsonb, proposal_id uuid, created_at timestamptz not null default now(),
      unique(agent_run_id,step),
      foreign key(user_id,agent_run_id) references agent_runs(user_id,id),
      foreign key(user_id,proposal_id) references ai_action_proposals(user_id,id)
    );
    update foundation_metadata set schema_version=10 where id=1;
  `.execute(db);
}
