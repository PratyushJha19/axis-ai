import { Router } from "express";
import { z } from "zod";
import { AIService } from "../../../packages/domain/src/ai.js";
import { providers } from "../../../packages/domain/src/ai-provider.js";
import type { Logger } from "pino";
import { decideChatAction } from "../../../packages/domain/src/chat-actions.js";
import type { Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
export function aiRouter(
  service: AIService,
  logger: Logger,
  db: Kysely<Database>,
) {
  const router = Router();
  router.post("/ai/actions/:id/decide", async (req, res) => {
    const result = await decideChatAction(
      db,
      res.locals.user.id,
      z.uuid().parse(req.params.id),
      req.body,
      res.locals.requestId,
    );
    logger.info({
      event: "chat_action_decided",
      requestId: res.locals.requestId,
      status: result.status,
    });
    res.json(result);
  });
  router.get("/ai/providers", (_req, res) =>
    res.json({ enabled: service.enabled, providers }),
  );
  router.get("/ai/config", async (_req, res) =>
    res.json({ config: await service.metadata(res.locals.user.id) }),
  );
  router.post("/ai/models", async (req, res) =>
    res.json(await service.models(res.locals.user.id, req.body)),
  );
  router.put("/ai/config", async (req, res) =>
    res.json({
      config: await service.save(
        res.locals.user.id,
        req.body,
        res.locals.requestId,
      ),
    }),
  );
  router.delete("/ai/config", async (_req, res) => {
    await service.remove(res.locals.user.id, res.locals.requestId);
    res.status(204).end();
  });
  router.post("/ai/test", async (req, res) =>
    res.json(
      await service.test(res.locals.user.id, req.body, res.locals.requestId),
    ),
  );
  router.get("/ai/conversations", async (_req, res) =>
    res.json({ items: await service.conversations(res.locals.user.id) }),
  );
  router.get("/ai/requests/:id", async (req, res) =>
    res.json(
      await service.requestStatus(
        res.locals.user.id,
        z.uuid().parse(req.params.id),
      ),
    ),
  );
  router.get("/ai/conversations/:id", async (req, res) =>
    res.json(
      await service.history(res.locals.user.id, z.uuid().parse(req.params.id)),
    ),
  );
  router.post("/ai/chat", async (req, res) => {
    const result = await service.chat(
      res.locals.user.id,
      req.body,
      res.locals.requestId,
    );
    const current = result.requests.find((row) => row.id === result.request_id);
    logger.info({
      event: "ai_chat_result",
      requestId: res.locals.requestId,
      status: current?.status,
      errorCode: current?.error_code,
    });
    res.json(result);
  });
  return router;
}
