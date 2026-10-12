import { Router } from "express";
import { z } from "zod";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import type { Profile } from "../../../packages/shared/src/contracts.js";
import {
  reminderListSchema,
  scheduleSchema,
  type Reminder,
  type Attempt,
} from "../../../packages/shared/src/reminders.js";
import {
  getReminder,
  saveReminder,
  cancelReminder,
  snoozeReminder,
  getPreferences,
  savePreferences,
  reconcileReminder,
} from "../../../packages/domain/src/reminders.js";
import { localToUtc } from "../../../packages/domain/src/reminder-time.js";
import { DomainError } from "../../../packages/domain/src/errors.js";

export function reminderRouter(db: Kysely<Database>, mode = "mock_only") {
  const router = Router();
  const version = (value: unknown) =>
    z.coerce.number().int().positive().parse(value);
  router.get("/reminder-preferences", async (_req, res) =>
    res.json(await getPreferences(db, (res.locals.user as Profile).id)),
  );
  router.put("/reminder-preferences", async (req, res) =>
    res.json(
      await savePreferences(
        db,
        (res.locals.user as Profile).id,
        req.body,
        z.coerce.number().int().min(0).parse(req.get("if-match")),
        res.locals.requestId,
      ),
    ),
  );
  router.post("/reminders/preview", (req, res) => {
    const value = scheduleSchema.parse(req.body);
    if (value.timezone !== (res.locals.user as Profile).timezone)
      throw new DomainError(
        "TIMEZONE_REQUIRED",
        422,
        "Use your configured profile timezone.",
      );
    res.json({
      due_at: localToUtc(value.local_due, value.timezone, value.disambiguation),
      timezone: value.timezone,
      channel_policy: mode === "live" ? "whatsapp_email" : "mock_only",
    });
  });
  router.get("/reminders", async (req, res) => {
    const page = reminderListSchema.parse(req.query);
    const result =
      await sql<Reminder>`select * from reminders where user_id=${(res.locals.user as Profile).id} order by created_at desc,id desc limit ${page.limit + 1} offset ${page.offset}`.execute(
        db,
      );
    res.json({
      items: result.rows.slice(0, page.limit),
      hasMore: result.rows.length > page.limit,
    });
  });
  router.post("/reminders", async (req, res) =>
    res
      .status(201)
      .json(
        await saveReminder(
          db,
          (res.locals.user as Profile).id,
          req.body,
          res.locals.requestId,
          { key: z.uuid().parse(req.get("idempotency-key")) },
        ),
      ),
  );
  router.get("/reminders/:id", async (req, res) =>
    res.json(
      await getReminder(
        db,
        (res.locals.user as Profile).id,
        z.uuid().parse(req.params.id),
      ),
    ),
  );
  router.patch("/reminders/:id", async (req, res) =>
    res.json(
      await saveReminder(
        db,
        (res.locals.user as Profile).id,
        req.body,
        res.locals.requestId,
        {
          id: z.uuid().parse(req.params.id),
          version: version(req.get("if-match")),
        },
      ),
    ),
  );
  router.post("/reminders/:id/cancel", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await cancelReminder(
        db,
        (res.locals.user as Profile).id,
        z.uuid().parse(req.params.id),
        version(req.get("if-match")),
        res.locals.requestId,
      ),
    );
  });
  router.post("/reminders/:id/snooze", async (req, res) => {
    const value = scheduleSchema.parse(req.body);
    if (value.timezone !== (res.locals.user as Profile).timezone)
      throw new DomainError(
        "TIMEZONE_REQUIRED",
        422,
        "Use your configured profile timezone.",
      );
    res.json(
      await snoozeReminder(
        db,
        (res.locals.user as Profile).id,
        z.uuid().parse(req.params.id),
        version(req.get("if-match")),
        localToUtc(value.local_due, value.timezone, value.disambiguation),
        res.locals.requestId,
      ),
    );
  });
  router.get("/reminders/:id/attempts", async (req, res) => {
    const owner = (res.locals.user as Profile).id;
    const row = await getReminder(db, owner, z.uuid().parse(req.params.id));
    const page = reminderListSchema.parse(req.query);
    const result =
      await sql<Attempt>`select * from notification_attempts where user_id=${owner} and reminder_id=${row.id} order by started_at desc,id desc limit ${page.limit + 1} offset ${page.offset}`.execute(
        db,
      );
    res.json({
      items: result.rows.slice(0, page.limit),
      hasMore: result.rows.length > page.limit,
    });
  });
  router.get("/system/status", async (_req, res) => {
    const owner = (res.locals.user as Profile).id;
    const result = await sql<{
      due: number;
      attention: number;
      unknown: number;
      lag_seconds: number;
    }>`select
      count(*) filter (where next_attempt_at <= now())::int as due,
      count(*) filter (where attention)::int as attention,
      count(*) filter (where status='unknown')::int as unknown,
      coalesce(extract(epoch from now()-min(next_attempt_at) filter (where next_attempt_at <= now())),0)::float as lag_seconds
      from reminders where user_id=${owner}`.execute(db);
    const worker = await sql<{
      healthy: boolean;
      last_seen_at: string | null;
    }>`select coalesce(max(last_seen_at)>now()-interval '90 seconds',false) as healthy,max(last_seen_at) as last_seen_at from worker_heartbeats`.execute(
      db,
    );
    const notifications = (
      await sql`select count(*) filter(where attention)::int as attention,count(*) filter(where status='unknown')::int as unknown,count(*) filter(where next_attempt_at<=now())::int as due from notification_jobs where user_id=${owner}`.execute(
        db,
      )
    ).rows[0];
    res.json({
      ...result.rows[0],
      worker: worker.rows[0],
      mode,
      notifications,
    });
  });
  router.post("/reminders/:id/reconcile", async (req, res) => {
    z.object({}).strict().parse(req.body);
    res.json(
      await reconcileReminder(
        db,
        (res.locals.user as Profile).id,
        z.uuid().parse(req.params.id),
        version(req.get("if-match")),
        res.locals.requestId,
      ),
    );
  });
  return router;
}
