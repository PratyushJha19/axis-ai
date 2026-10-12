import { Router } from "express";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import { reminderRouter } from "./reminder-routes.js";
import type { Database } from "../../../packages/database/src/index.js";
import {
  listSchema,
  timezoneSchema,
  type Profile,
  type Table,
} from "../../../packages/shared/src/contracts.js";
import {
  audit,
  deleteRecord,
  getRecord,
  listRecords,
  saveRecord,
} from "../../../packages/domain/src/records.js";

const versionSchema = z.coerce.number().int().positive();
export function productRouter(db: Kysely<Database>, mode = "mock_only") {
  const router = Router();
  router.use(reminderRouter(db, mode));
  router.get("/summary", async (_req, res) => {
    const id = (res.locals.user as Profile).id;
    const result = await sql`select
      (select count(*)::int from tasks where user_id=${id} and archived_at is null and status not in ('completed','cancelled')) as active_tasks,
      (select count(*)::int from tasks where user_id=${id} and status='completed') as completed_tasks,
      (select count(*)::int from projects where user_id=${id} and status='active') as projects,
      (select count(*)::int from memory_items where user_id=${id} and archived_at is null) as memories`.execute(
      db,
    );
    res.json(result.rows[0]);
  });
  router.get("/me", (req, res) =>
    res.json({ user: res.locals.user, csrfToken: req.session.csrf }),
  );
  router.patch("/me", async (req, res) => {
    const value = z
      .object({
        display_name: z.string().trim().min(1).max(120),
        timezone: timezoneSchema,
      })
      .strict()
      .parse(req.body);
    const user: Profile = res.locals.user;
    await sql`update users set display_name=${value.display_name},timezone=${value.timezone},updated_at=now() where id=${user.id}`.execute(
      db,
    );
    res.json({ user: { ...user, ...value } });
  });
  router.post("/logout", async (req, res) => {
    await audit(
      db,
      (res.locals.user as Profile).id,
      "logout",
      null,
      res.locals.requestId,
    );
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie("axis.sid", { path: "/" });
    res.status(204).end();
  });
  for (const [route, table] of Object.entries({
    projects: "projects",
    tasks: "tasks",
    memories: "memory_items",
  }) as [string, Table][]) {
    router.get(`/${route}`, async (req, res) =>
      res.json(
        await listRecords(
          db,
          table,
          (res.locals.user as Profile).id,
          listSchema.parse(req.query),
        ),
      ),
    );
    router.get(`/${route}/:id`, async (req, res) =>
      res.json(
        await getRecord(
          db,
          table,
          (res.locals.user as Profile).id,
          z.uuid().parse(req.params.id),
        ),
      ),
    );
    router.post(`/${route}`, async (req, res) => {
      const key = z.uuid().parse(req.get("idempotency-key"));
      res
        .status(201)
        .json(
          await saveRecord(
            db,
            table,
            (res.locals.user as Profile).id,
            req.body,
            res.locals.requestId,
            { key },
          ),
        );
    });
    router.patch(`/${route}/:id`, async (req, res) =>
      res.json(
        await saveRecord(
          db,
          table,
          (res.locals.user as Profile).id,
          req.body,
          res.locals.requestId,
          {
            id: z.uuid().parse(req.params.id),
            version: versionSchema.parse(req.get("if-match")),
          },
        ),
      ),
    );
    router.delete(`/${route}/:id`, async (req, res) => {
      await deleteRecord(
        db,
        table,
        (res.locals.user as Profile).id,
        z.uuid().parse(req.params.id),
        versionSchema.parse(req.get("if-match")),
        res.locals.requestId,
      );
      res.status(204).end();
    });
  }
  router.get("/tasks/:id/events", async (req, res) => {
    const userId = (res.locals.user as Profile).id;
    const id = z.uuid().parse(req.params.id);
    await getRecord(db, "tasks", userId, id);
    const page = listSchema.parse(req.query);
    const events =
      await sql`select id,event_type,from_status,to_status,created_at from task_events where user_id=${userId} and task_id=${id} order by created_at desc,id desc limit ${page.limit} offset ${page.offset}`.execute(
        db,
      );
    res.json({ items: events.rows });
  });
  return router;
}
