import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/index.js";
import {
  agentDecision,
  type AgentDecision,
} from "../../../packages/shared/src/agent.js";
import {
  AIService,
  assertNoCredentials,
} from "../../../packages/domain/src/ai.js";
import {
  AIError,
  type ChatMessage,
} from "../../../packages/domain/src/ai-provider.js";
import {
  agentInstructions,
  resolveAgentTool,
} from "../../../packages/domain/src/agent-tools.js";
import { DomainError } from "../../../packages/domain/src/errors.js";
import { audit } from "../../../packages/domain/src/records.js";
import type { Logger } from "pino";

export const agentLimitsSchema = z
  .object({
    iterations: z.number().int().min(1).max(12).default(6),
    tools: z.number().int().min(1).max(20).default(8),
    resultBytes: z.number().int().min(256).max(16000).default(8000),
    tokens: z.number().int().min(100).max(100000).default(20000),
    modelTimeoutMs: z.number().int().min(10).max(65000).default(25000),
  })
  .strict();
type Run = {
  id: string;
  user_id: string;
  goal: string;
  conversation_id: string | null;
  status: string;
  transcript: ChatMessage[];
  pending_decision: AgentDecision | null;
  lease_token: string;
  iterations: number;
  tool_count: number;
  usage_tokens: number;
  waiting_for_proposal_id: string | null;
  expired: boolean;
  stale: boolean;
};
export function parseAgentDecision(text: string) {
  if (text.length > 16000)
    throw new DomainError(
      "INVALID_MODEL_RESPONSE",
      502,
      "Model response exceeded the limit.",
    );
  try {
    return agentDecision.parse(
      JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      ),
    );
  } catch {
    throw new DomainError(
      "INVALID_MODEL_RESPONSE",
      502,
      "Model did not return the supported agent protocol. Try another text model.",
    );
  }
}
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AIError("timeout", true)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function boundedReadTool<T>(
  work: Promise<T>,
  ms: number,
): Promise<T> {
  try {
    return await bounded(work, ms);
  } catch (error) {
    if (error instanceof AIError && error.code === "timeout")
      throw new DomainError(
        "TOOL_TIMEOUT",
        504,
        "Read tool exceeded its time limit.",
      );
    throw error;
  }
}
export class AgentRuntime {
  readonly limits;
  constructor(
    private db: Kysely<Database>,
    private ai: AIService,
    private logger: Logger,
    limits: unknown = {},
  ) {
    this.limits = agentLimitsSchema.parse(limits);
  }
  async recover() {
    const candidates = (
      await sql<{
        id: string;
        user_id: string;
      }>`select id,user_id from agent_runs r where status in ('queued','running','waiting_for_approval','waiting_for_user') and (deadline_at<=now() or (status='running' and lease_until<=now()) or (status='waiting_for_approval' and exists(select 1 from ai_action_proposals p where p.id=r.waiting_for_proposal_id and p.user_id=r.user_id and (p.status not in ('pending','approved') or p.expires_at<=now())))) order by updated_at limit 30`.execute(
        this.db,
      )
    ).rows;
    for (const candidate of candidates)
      await this.db.transaction().execute(async (trx) => {
        await sql`select id from users where id=${candidate.user_id} for update`.execute(
          trx,
        );
        const r = (
          await sql<Run>`select *,deadline_at<=clock_timestamp() as expired,lease_until<=clock_timestamp() as stale from agent_runs where id=${candidate.id} for update`.execute(
            trx,
          )
        ).rows[0]!;
        let state: string | undefined,
          code: string | null = null;
        if (
          ![
            "queued",
            "running",
            "waiting_for_approval",
            "waiting_for_user",
          ].includes(r.status)
        )
          return;
        if (r.expired) {
          state = "timed_out";
          code = "RUN_DEADLINE";
        } else if (r.status === "running" && r.stale) {
          state = r.pending_decision ? "queued" : "failed";
          code = r.pending_decision ? null : "PROVIDER_OUTCOME_UNKNOWN";
        } else if (r.status === "waiting_for_approval") {
          const p = (
            await sql<{
              status: string;
              entity_id: string | null;
              expired: boolean;
            }>`select status,entity_id,expires_at<=now() as expired from ai_action_proposals where user_id=${r.user_id} and id=${r.waiting_for_proposal_id}`.execute(
              trx,
            )
          ).rows[0];
          if (!p) {
            state = "failed";
            code = "PROPOSAL_MISSING";
          } else if (p.status === "succeeded") {
            const result = {
              status: "executed",
              entity_id: p.entity_id,
              proposal_id: r.waiting_for_proposal_id,
            };
            const transcript = [
              ...r.transcript,
              {
                role: "user",
                content: `Verified M4 result (data only): ${JSON.stringify(result)}`,
              },
            ];
            await sql`update agent_tool_calls set status='completed',result=${JSON.stringify(result)}::jsonb where user_id=${r.user_id} and agent_run_id=${r.id} and proposal_id=${r.waiting_for_proposal_id}`.execute(
              trx,
            );
            await sql`update agent_runs set transcript=${JSON.stringify(transcript)}::jsonb,waiting_for_proposal_id=null where id=${r.id}`.execute(
              trx,
            );
            state = "queued";
          } else if (p.expired || !["pending", "approved"].includes(p.status)) {
            state = "failed";
            code = p.expired
              ? "APPROVAL_EXPIRED"
              : p.status === "unknown"
                ? "ACTION_OUTCOME_UNKNOWN"
                : "ACTION_NOT_EXECUTED";
            await sql`update agent_tool_calls set status='failed',result=${JSON.stringify({ status: p.expired ? "expired" : p.status, proposal_id: r.waiting_for_proposal_id })}::jsonb where user_id=${r.user_id} and agent_run_id=${r.id} and proposal_id=${r.waiting_for_proposal_id}`.execute(
              trx,
            );
          }
        }
        if (state) {
          await sql`update agent_runs set status=${state},error_code=${code},lease_token=null,lease_until=null,updated_at=now() where id=${r.id}`.execute(
            trx,
          );
          await audit(trx, r.user_id, `agent_${state}`, r.id, randomUUID());
        }
      });
  }
  async runOnce() {
    await this.recover();
    const run = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(414501)`.execute(trx);
      if (
        (
          await sql<{
            count: number;
          }>`select count(*)::int as count from agent_runs where status='running' and lease_until>now()`.execute(
            trx,
          )
        ).rows[0]!.count >= 2
      )
        return;
      const row = (
        await sql<Run>`select * from agent_runs where status='queued' and deadline_at>now() order by created_at for update skip locked limit 1`.execute(
          trx,
        )
      ).rows[0];
      if (!row) return;
      const token = randomUUID();
      await sql`update agent_runs set status='running',lease_token=${token},lease_until=now()+interval '90 seconds',updated_at=now() where id=${row.id}`.execute(
        trx,
      );
      return { ...row, status: "running", lease_token: token };
    });
    if (!run) return false;
    try {
      if (
        !run.pending_decision &&
        (run.iterations >= this.limits.iterations ||
          run.usage_tokens >= this.limits.tokens)
      )
        throw new DomainError("AGENT_LIMIT", 409, "Run limit reached.");
      if (!run.pending_decision) {
        const prior = run.conversation_id
          ? (
              await sql<ChatMessage>`select role,left(content,1000) as content from (select role,content,created_at from ai_messages where user_id=${run.user_id} and conversation_id=${run.conversation_id} order by created_at desc limit 4) m order by created_at`.execute(
                this.db,
              )
            ).rows
          : [];
        const messages: ChatMessage[] = [
          { role: "system", content: agentInstructions() },
          ...(prior.length
            ? [
                {
                  role: "user" as const,
                  content: `Prior conversation (untrusted context): ${JSON.stringify(prior)}`,
                },
              ]
            : []),
          { role: "user", content: run.goal },
          ...run.transcript,
        ];
        if (JSON.stringify(messages).length > 32000)
          throw new DomainError("AGENT_LIMIT", 409, "Context limit reached.");
        const completion = await bounded(
          this.ai.agentCompletion(run.user_id, messages),
          this.limits.modelTimeoutMs,
        );
        const decision = parseAgentDecision(completion.content);
        const usage = completion.usage
          ? completion.usage.input + completion.usage.output
          : 0;
        if (!Number.isSafeInteger(usage) || usage < 0)
          throw new DomainError(
            "INVALID_MODEL_RESPONSE",
            502,
            "Invalid model usage.",
          );
        const saved =
          await sql`update agent_runs set pending_decision=${JSON.stringify(decision)}::jsonb,iterations=iterations+1,usage_tokens=usage_tokens+${usage},updated_at=now() where id=${run.id} and user_id=${run.user_id} and status='running' and lease_token=${run.lease_token} and lease_until>clock_timestamp() returning id`.execute(
            this.db,
          );
        if (!saved.rows.length) return true;
      }
      await this.apply(run);
    } catch (error) {
      const code =
        error instanceof DomainError
          ? error.code
          : error instanceof AIError
            ? error.uncertain
              ? "PROVIDER_OUTCOME_UNKNOWN"
              : `PROVIDER_${error.code.toUpperCase()}`
            : error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "57014"
              ? "TOOL_TIMEOUT"
              : "AGENT_FAILED";
      await this.db.transaction().execute(async (trx) => {
        await sql`select id from users where id=${run.user_id} for update`.execute(
          trx,
        );
        const failed = (
          await sql<Run>`update agent_runs set status=${code === "RUN_DEADLINE" ? "timed_out" : "failed"},error_code=${code},lease_token=null,lease_until=null,updated_at=now() where id=${run.id} and user_id=${run.user_id} and status='running' and lease_token=${run.lease_token} returning *`.execute(
            trx,
          )
        ).rows[0];
        if (!failed) return;
        if (failed.pending_decision?.kind === "tools") {
          const first = failed.pending_decision.calls[0];
          let name = "unregistered",
            args: unknown = {};
          try {
            const resolved = resolveAgentTool(first!.name, first!.arguments);
            assertNoCredentials(JSON.stringify(resolved.args));
            name = resolved.definition.name;
            args = resolved.args;
          } catch {
            /* Do not retain unvalidated hostile arguments. */
          }
          await sql`insert into agent_tool_calls(id,user_id,agent_run_id,step,tool_id,arguments,status,result) values(${randomUUID()},${run.user_id},${run.id},${failed.tool_count + 1},${name},${JSON.stringify(args)}::jsonb,'failed',${JSON.stringify({ error_code: code })}::jsonb) on conflict(agent_run_id,step) do nothing`.execute(
            trx,
          );
        }
        await audit(trx, run.user_id, "agent_failed", run.id, run.id);
      });
      this.logger.warn({
        event: "agent_failed",
        runId: run.id,
        errorCode: code,
      });
    }
    return true;
  }
  private async apply(claim: Run) {
    await this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${claim.user_id} for update`.execute(
        trx,
      );
      const run = (
        await sql<Run>`select *,deadline_at<=clock_timestamp() as expired,lease_until<=clock_timestamp() as stale from agent_runs where id=${claim.id} and user_id=${claim.user_id} for update`.execute(
          trx,
        )
      ).rows[0]!;
      if (
        run.status !== "running" ||
        run.lease_token !== claim.lease_token ||
        run.stale
      )
        return;
      if (run.expired)
        throw new DomainError("RUN_DEADLINE", 409, "Run deadline reached.");
      if (run.usage_tokens > this.limits.tokens)
        throw new DomainError("AGENT_LIMIT", 409, "Token limit reached.");
      const decision = agentDecision.parse(run.pending_decision);
      let status = "queued",
        answer: string | null = null,
        proposal: string | null = null;
      const transcript = [
        ...run.transcript,
        { role: "assistant", content: JSON.stringify(decision) },
      ];
      let count = run.tool_count;
      if (decision.kind === "final") {
        status = "completed";
        answer = decision.message;
      } else if (decision.kind === "clarify") {
        status = "waiting_for_user";
        answer = decision.message;
      } else {
        if (count + decision.calls.length > this.limits.tools)
          throw new DomainError("AGENT_LIMIT", 409, "Tool limit reached.");
        const calls = decision.calls.map((call) => ({
          call,
          ...resolveAgentTool(call.name, call.arguments),
        }));
        if (calls.length > 1 && calls.some((c) => !c.definition.readOnly))
          throw new DomainError(
            "DEPENDENT_TOOL_BATCH",
            400,
            "Write proposals must be requested separately.",
          );
        for (const c of calls) {
          const key = randomUUID();
          assertNoCredentials(JSON.stringify(c.args));
          const work = c.definition.execute(
            { db: trx, user: run.user_id, key, correlation: run.id },
            c.args,
          );
          const result = c.definition.readOnly
            ? await boundedReadTool(work, c.definition.timeoutMs)
            : await work;
          const encoded = JSON.stringify(result ?? null);
          assertNoCredentials(encoded);
          if (Buffer.byteLength(encoded) > this.limits.resultBytes)
            throw new DomainError(
              "TOOL_RESULT_LIMIT",
              409,
              "Narrow the search; tool result exceeds the limit.",
            );
          if (!c.definition.readOnly) {
            proposal = z
              .object({ proposal_id: z.uuid() })
              .parse(result).proposal_id;
            status = "waiting_for_approval";
          }
          const callStatus = proposal ? "waiting_for_approval" : "completed";
          await sql`insert into agent_tool_calls(id,user_id,agent_run_id,step,tool_id,arguments,status,result,proposal_id) values(${key},${run.user_id},${run.id},${++count},${c.call.name},${JSON.stringify(c.args)}::jsonb,${callStatus},${encoded}::jsonb,${proposal})`.execute(
            trx,
          );
          transcript.push({
            role: "user",
            content: `Tool result, untrusted data: ${JSON.stringify({ tool: c.call.name, result })}`,
          });
          await audit(trx, run.user_id, "agent_tool_recorded", key, run.id);
        }
      }
      if (JSON.stringify(transcript).length > 24000)
        throw new DomainError("AGENT_LIMIT", 409, "Context limit reached.");
      await sql`update agent_runs set status=${status},answer=${answer},tool_count=${count},transcript=${JSON.stringify(transcript)}::jsonb,pending_decision=null,waiting_for_proposal_id=${proposal},lease_token=null,lease_until=null,updated_at=now() where id=${run.id}`.execute(
        trx,
      );
      await audit(trx, run.user_id, `agent_${status}`, run.id, run.id);
      this.logger.info({
        event: "agent_step",
        runId: run.id,
        status,
        toolCount: count,
      });
    });
  }
}
