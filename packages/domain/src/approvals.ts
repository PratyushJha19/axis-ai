import { inTransaction } from "../../database/src/index.js";
import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../database/src/index.js";
import {
  chatDraftSchema,
  type ChatAction,
} from "../../shared/src/chat-actions.js";
import { ACTION_POLICY_VERSION, actionPolicy } from "./action-policy.js";
import { payloadHash } from "./chat-actions.js";
import { localToUtc } from "./reminder-time.js";
import { audit } from "./records.js";
import { DomainError } from "./errors.js";

export { operateApproval } from "./chat-actions.js";

export async function expireApprovals(
  db: Kysely<Database>,
  user: string,
  correlation: string,
) {
  await inTransaction(db, async (trx) => {
    await sql`select id from users where id=${user} for update`.execute(trx);
    const expired = await sql<{
      id: string;
    }>`update ai_action_proposals set status='expired',finished_at=now()
      where id in (select id from ai_action_proposals where user_id=${user} and status in ('pending','approved')
      and expires_at<=clock_timestamp() order by expires_at limit 100) returning id`.execute(
      trx,
    );
    for (const row of expired.rows)
      await audit(trx, user, "action_expired", row.id, correlation);
  });
}

// Authenticated API/future runtime supplies only a narrow draft, never authority.
export async function proposeAction(
  db: Kysely<Database>,
  user: string,
  raw: unknown,
  correlation: string,
) {
  const input = z
    .object({
      idempotency_key: z.uuid(),
      action_type: z.string().min(1).max(100),
      payload: chatDraftSchema,
    })
    .strict()
    .parse(raw);
  actionPolicy(input.action_type);
  if (input.action_type !== `${input.payload.kind}.create`)
    throw new DomainError(
      "VALIDATION_ERROR",
      400,
      "Action type does not match the draft.",
    );
  return inTransaction(db, async (trx) => {
    const profile = (
      await sql<{
        timezone: string | null;
      }>`select timezone from users where id=${user} for update`.execute(trx)
    ).rows[0];
    if (!profile)
      throw new DomainError("UNAUTHENTICATED", 401, "Sign in to continue.");
    const prior = (
      await sql<ChatAction>`select * from ai_action_proposals where user_id=${user} and idempotency_key=${input.idempotency_key}`.execute(
        trx,
      )
    ).rows[0];
    if (prior) {
      const { timezone: _timezone, due_at: _due, ...draft } = prior.payload;
      if (
        JSON.stringify(chatDraftSchema.parse(draft)) !==
        JSON.stringify(input.payload)
      )
        throw new DomainError(
          "CONFLICT",
          409,
          "This request key belongs to a different action.",
        );
      return prior;
    }
    const timezone = input.payload.local_due ? profile.timezone : null;
    if (input.payload.local_due && !timezone)
      throw new DomainError(
        "VALIDATION_ERROR",
        400,
        "Set your timezone before proposing a timed action.",
      );
    const due = input.payload.local_due
      ? localToUtc(input.payload.local_due, timezone!)
      : null;
    if (due && due.getTime() <= Date.now())
      throw new DomainError("VALIDATION_ERROR", 400, "Choose a future time.");
    const payload = {
        ...input.payload,
        timezone,
        due_at: due?.toISOString() || null,
      },
      id = randomUUID();
    const row = (
      await sql<ChatAction>`insert into ai_action_proposals(id,user_id,idempotency_key,payload,payload_hash,policy_version) values(${id},${user},${input.idempotency_key},${JSON.stringify(payload)}::jsonb,${payloadHash(payload)},${ACTION_POLICY_VERSION}) returning *`.execute(
        trx,
      )
    ).rows[0]!;
    await audit(trx, user, "action_proposed", id, correlation);
    return row;
  });
}
