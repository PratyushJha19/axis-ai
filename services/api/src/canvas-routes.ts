import { Router } from "express";
import { z } from "zod";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import {
  getCanvas,
  saveCanvas,
  deleteCanvas,
  canvasTask,
} from "../../../packages/domain/src/canvas.js";

export function canvasRouter(db: Kysely<Database>) {
  const router = Router();
  router.post("/canvases/:id/nodes/:node/task", async (req, res) =>
    res.json(
      await canvasTask(
        db,
        res.locals.user.id,
        z.uuid().parse(req.params.id),
        z.uuid().parse(req.params.node),
        z.coerce.number().int().positive().parse(req.get("if-match")),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  router.get("/canvases", async (req, res) => {
    const query = z
      .object({
        project_id: z.uuid().optional(),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .strict()
      .parse(req.query);
    const rows =
      await sql`select id,name,project_id,version,updated_at from canvases where user_id=${res.locals.user.id} ${query.project_id ? sql`and project_id=${query.project_id}` : sql``} order by updated_at desc,id limit 31 offset ${query.offset}`.execute(
        db,
      );
    res.json({ items: rows.rows.slice(0, 30), hasMore: rows.rows.length > 30 });
  });
  router.get("/canvases/:id", async (req, res) =>
    res.json(
      await getCanvas(db, res.locals.user.id, z.uuid().parse(req.params.id)),
    ),
  );
  router.put("/canvases/:id", async (req, res) =>
    res.json(
      await saveCanvas(
        db,
        res.locals.user.id,
        z.uuid().parse(req.params.id),
        req.body,
        req.get("if-match")
          ? z.coerce.number().int().positive().parse(req.get("if-match"))
          : null,
        res.locals.requestId,
      ),
    ),
  );
  router.delete("/canvases/:id", async (req, res) => {
    await deleteCanvas(
      db,
      res.locals.user.id,
      z.uuid().parse(req.params.id),
      z.coerce.number().int().positive().parse(req.get("if-match")),
      res.locals.requestId,
    );
    res.status(204).end();
  });
  return router;
}
