import { Router } from "express";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/index.js";
import {
  operateApproval,
  proposeAction,
  expireApprovals,
} from "../../../packages/domain/src/approvals.js";
import { DomainError } from "../../../packages/domain/src/errors.js";

export function approvalRouter(db: Kysely<Database>) {
  const router = Router();
  router.post("/approvals", async (req, res) => {
    const row = await proposeAction(
      db,
      res.locals.user.id,
      req.body,
      res.locals.requestId,
    );
    res.json({
      id: row.id,
      payload: row.payload,
      payload_hash: row.payload_hash,
      status: row.status === "succeeded" ? "executed" : row.status,
      expires_at: row.expires_at,
    });
  });
  router.get("/approvals", async (req, res) => {
    await expireApprovals(db, res.locals.user.id, res.locals.requestId);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(req.query.offset ?? 0);
    const rows = await sql`select id,payload,payload_hash,policy_version,
      case when status in ('pending','approved') and expires_at<=now() then 'expired'
        when status='succeeded' then 'executed' else status end as status,
      created_at,expires_at,approved_at,execution_started_at,finished_at,entity_id,failure_code
      from ai_action_proposals where user_id=${res.locals.user.id}
      order by created_at desc,id limit 31 offset ${offset}`.execute(db);
    res.json({ items: rows.rows.slice(0, 30), hasMore: rows.rows.length > 30 });
  });
  router.get("/approvals/:id", async (req, res) => {
    await expireApprovals(db, res.locals.user.id, res.locals.requestId);
    const row = (
      await sql`select id,payload,payload_hash,policy_version,
      case when status='succeeded' then 'executed' when status in ('pending','approved') and expires_at<=now() then 'expired' else status end as status,
      expires_at,created_at,approved_at,execution_started_at,finished_at,entity_id,failure_code
      from ai_action_proposals where user_id=${res.locals.user.id} and id=${z.uuid().parse(req.params.id)}`.execute(
        db,
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", 404, "Proposal not found.");
    res.json(row);
  });
  router.get("/approvals/:id/events", async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      user = res.locals.user.id;
    const found =
      await sql`select id from ai_action_proposals where id=${id} and user_id=${user}`.execute(
        db,
      );
    if (!found.rows.length)
      throw new DomainError("NOT_FOUND", 404, "Proposal not found.");
    const events =
      await sql`select event_type,created_at from audit_events where user_id=${user} and entity_id=${id} order by created_at limit 100`.execute(
        db,
      );
    res.json({ items: events.rows });
  });
  router.post("/approvals/:id/:operation", async (req, res) => {
    const operation = z
      .enum(["approve", "execute", "reject", "cancel"])
      .parse(req.params.operation);
    const body = z
      .object({ payload_hash: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const result = await operateApproval(
      db,
      res.locals.user.id,
      z.uuid().parse(req.params.id),
      {
        ...body,
        decision: operation === "reject" ? "reject" : "confirm",
      },
      res.locals.requestId,
      operation,
    );
    res.json({
      ...result,
      status: result.status === "succeeded" ? "executed" : result.status,
    });
  });
  return router;
}
