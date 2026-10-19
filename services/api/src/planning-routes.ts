import { Router } from "express";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import { PlanningService } from "../../../packages/domain/src/planning.js";
import type { AIService } from "../../../packages/domain/src/ai.js";
export function planningRouter(db: Kysely<Database>, ai: AIService) {
  const r = Router(),
    svc = new PlanningService(db);
  const offset = (v: unknown) =>
    z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(v ?? 0);
  r.get("/intelligence/briefing", async (_q, s) =>
    s.json(await svc.briefing(s.locals.user.id)),
  );
  r.get("/intelligence/priorities", async (q, s) => {
    const b = await svc.briefing(s.locals.user.id),
      start = offset(q.query.offset);
    s.json({
      items: b.priorities.slice(start, start + 30),
      hasMore: b.priorities.length > start + 30,
      limited: b.limited,
    });
  });
  r.post("/intelligence/refresh", async (q, s) =>
    s.json(
      await svc.recommend(s.locals.user.id, q.body, ai, s.locals.requestId),
    ),
  );
  r.post("/intelligence/feedback", async (q, s) =>
    s.json(await svc.feedback(s.locals.user.id, q.body, s.locals.requestId)),
  );
  r.get("/planning-preferences", async (_q, s) =>
    s.json(await svc.preferences(s.locals.user.id)),
  );
  r.put("/planning-preferences", async (q, s) =>
    s.json(
      await svc.savePreferences(s.locals.user.id, q.body, s.locals.requestId),
    ),
  );
  r.get("/plans", async (q, s) =>
    s.json(await svc.list(s.locals.user.id, offset(q.query.offset))),
  );
  r.post("/plans/generate", async (q, s) =>
    s
      .status(201)
      .json(await svc.generate(s.locals.user.id, q.body, s.locals.requestId)),
  );
  r.get("/plans/:id", async (q, s) =>
    s.json(await svc.detail(s.locals.user.id, z.uuid().parse(q.params.id))),
  );
  r.post("/plans/:id", async (q, s) =>
    s.json(
      await svc.update(
        s.locals.user.id,
        z.uuid().parse(q.params.id),
        q.body,
        s.locals.requestId,
      ),
    ),
  );
  r.get("/intelligence/recovery/:id", async (q, s) =>
    s.json(
      await svc.recoveryPreview(s.locals.user.id, z.uuid().parse(q.params.id)),
    ),
  );
  r.post("/intelligence/recovery/:id", async (q, s) =>
    s.json(
      await svc.reschedule(
        s.locals.user.id,
        z.uuid().parse(q.params.id),
        q.body,
        s.locals.requestId,
      ),
    ),
  );
  return r;
}
