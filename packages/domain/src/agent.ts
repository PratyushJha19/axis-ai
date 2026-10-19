import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../database/src/index.js";
import {
  agentInput,
  type AgentRun,
  type AgentCall,
} from "../../shared/src/agent.js";
import { assertNoCredentials } from "./ai.js";
import { operateApproval, expireApprovals } from "./approvals.js";
import { audit } from "./records.js";
import { DomainError } from "./errors.js";

export class AgentService {
  constructor(private db: Kysely<Database>) {}
  async submit(user: string, raw: unknown, correlation: string) {
    const input = agentInput.parse(raw);
    assertNoCredentials(input.goal);
    const hash = createHash("sha256")
      .update(JSON.stringify([input.goal, input.conversation_id || null]))
      .digest("hex");
    return this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${user} for update`.execute(trx);
      const old = (
        await sql<
          AgentRun & { input_hash: string }
        >`select * from agent_runs where user_id=${user} and idempotency_key=${input.idempotency_key}`.execute(
          trx,
        )
      ).rows[0];
      if (old) {
        if (old.input_hash !== hash)
          throw new DomainError(
            "CONFLICT",
            409,
            "Request key already used for a different goal.",
          );
        return { id: old.id, status: old.status };
      }
      if (
        input.conversation_id &&
        !(
          await sql`select id from ai_conversations where user_id=${user} and id=${input.conversation_id}`.execute(
            trx,
          )
        ).rows.length
      )
        throw new DomainError("NOT_FOUND", 404, "Conversation not found.");
      const counts = (
        await sql<{
          active: number;
          recent: number;
        }>`select count(*) filter(where status in ('queued','running','waiting_for_approval','waiting_for_user'))::int as active,count(*) filter(where created_at>now()-interval '1 hour')::int as recent from agent_runs where user_id=${user}`.execute(
          trx,
        )
      ).rows[0]!;
      if (counts.active >= 3 || counts.recent >= 20)
        throw new DomainError(
          "AGENT_RATE_LIMIT",
          429,
          "Agent run limit reached. Finish or cancel existing runs, or try later.",
        );
      const id = randomUUID();
      await sql`insert into agent_runs(id,user_id,conversation_id,idempotency_key,input_hash,goal) values(${id},${user},${input.conversation_id || null},${input.idempotency_key},${hash},${input.goal})`.execute(
        trx,
      );
      await audit(trx, user, "agent_queued", id, correlation);
      return { id, status: "queued" };
    });
  }
  async list(user: string, raw: unknown) {
    const q = z
      .object({
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        status: z
          .enum([
            "queued",
            "running",
            "waiting_for_approval",
            "waiting_for_user",
            "completed",
            "failed",
            "cancelled",
            "timed_out",
          ])
          .optional(),
      })
      .strict()
      .parse(raw);
    const rows = (
      await sql<AgentRun>`select id,goal,status,answer,error_code,waiting_for_proposal_id,iterations,tool_count,created_at from agent_runs where user_id=${user} ${q.status ? sql`and status=${q.status}` : sql``} order by created_at desc,id limit 21 offset ${q.offset}`.execute(
        this.db,
      )
    ).rows;
    return { items: rows.slice(0, 20), hasMore: rows.length > 20 };
  }
  async detail(user: string, id: string) {
    const run = (
      await sql<AgentRun>`select id,goal,status,answer,error_code,waiting_for_proposal_id,iterations,tool_count,created_at from agent_runs where user_id=${user} and id=${id}`.execute(
        this.db,
      )
    ).rows[0];
    if (!run) throw new DomainError("NOT_FOUND", 404, "Run not found.");
    const calls = (
      await sql<AgentCall>`select id,tool_id,status,result,proposal_id from agent_tool_calls where user_id=${user} and agent_run_id=${id} order by step`.execute(
        this.db,
      )
    ).rows;
    return { run, calls };
  }
  async change(
    user: string,
    id: string,
    raw: unknown,
    correlation: string,
    cancel = false,
  ) {
    const input = cancel
      ? z.object({}).strict().parse(raw)
      : z
          .object({ message: z.string().trim().min(1).max(2000) })
          .strict()
          .parse(raw);
    if ("message" in input) assertNoCredentials(input.message);
    return this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${user} for update`.execute(trx);
      const row = (
        await sql<{
          status: string;
          waiting_for_proposal_id: string | null;
          transcript: unknown[];
        }>`select status,waiting_for_proposal_id,transcript from agent_runs where user_id=${user} and id=${id} for update`.execute(
          trx,
        )
      ).rows[0];
      if (!row) throw new DomainError("NOT_FOUND", 404, "Run not found.");
      if (cancel) {
        if (
          ["completed", "failed", "timed_out", "cancelled"].includes(row.status)
        )
          return { status: row.status };
        if (row.waiting_for_proposal_id) {
          await expireApprovals(trx, user, correlation);
          const p = (
            await sql<{
              status: string;
              payload_hash: string;
              entity_id: string | null;
            }>`select status,payload_hash,entity_id from ai_action_proposals where user_id=${user} and id=${row.waiting_for_proposal_id}`.execute(
              trx,
            )
          ).rows[0];
          if (p && ["pending", "approved"].includes(p.status))
            await operateApproval(
              trx,
              user,
              row.waiting_for_proposal_id,
              { decision: "confirm", payload_hash: p.payload_hash },
              correlation,
              "cancel",
            );
          const completed = p?.status === "succeeded";
          await sql`update agent_tool_calls set status=${completed ? "completed" : "cancelled"},result=${JSON.stringify({ status: completed ? "executed" : p?.status === "unknown" ? "unknown" : "cancelled", entity_id: p?.entity_id || null, proposal_id: row.waiting_for_proposal_id })}::jsonb where user_id=${user} and agent_run_id=${id} and status='waiting_for_approval'`.execute(
            trx,
          );
        }
        await sql`update agent_runs set status='cancelled',lease_token=null,lease_until=null,updated_at=now() where user_id=${user} and id=${id}`.execute(
          trx,
        );
      } else {
        if (row.status !== "waiting_for_user")
          throw new DomainError(
            "CONFLICT",
            409,
            "This run is not waiting for clarification.",
          );
        const transcript = [
          ...row.transcript,
          { role: "user", content: (input as { message: string }).message },
        ];
        if (JSON.stringify(transcript).length > 24000)
          throw new DomainError(
            "AGENT_LIMIT",
            409,
            "Run context limit reached. Start a new run.",
          );
        await sql`update agent_runs set status='queued',answer=null,transcript=${JSON.stringify(transcript)}::jsonb,updated_at=now() where user_id=${user} and id=${id}`.execute(
          trx,
        );
      }
      await audit(
        trx,
        user,
        cancel ? "agent_cancelled" : "agent_clarified",
        id,
        correlation,
      );
      return { status: cancel ? "cancelled" : "queued" };
    });
  }
}
