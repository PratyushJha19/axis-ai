import { Router } from "express";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import { AgentService } from "../../../packages/domain/src/agent.js";
export function agentRouter(db: Kysely<Database>) {
  const router = Router(),
    service = new AgentService(db);
  router.post("/agent/runs", async (req, res) =>
    res
      .status(202)
      .json(
        await service.submit(
          res.locals.user.id,
          req.body,
          res.locals.requestId,
        ),
      ),
  );
  router.get("/agent/runs", async (req, res) =>
    res.json(await service.list(res.locals.user.id, req.query)),
  );
  router.get("/agent/runs/:id", async (req, res) =>
    res.json(
      await service.detail(res.locals.user.id, z.uuid().parse(req.params.id)),
    ),
  );
  router.post("/agent/runs/:id/cancel", async (req, res) =>
    res.json(
      await service.change(
        res.locals.user.id,
        z.uuid().parse(req.params.id),
        req.body,
        res.locals.requestId,
        true,
      ),
    ),
  );
  router.post("/agent/runs/:id/clarify", async (req, res) =>
    res.json(
      await service.change(
        res.locals.user.id,
        z.uuid().parse(req.params.id),
        req.body,
        res.locals.requestId,
      ),
    ),
  );
  return router;
}
