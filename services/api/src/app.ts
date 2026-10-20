import { randomUUID } from "node:crypto";
import express from "express";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import { checkRecovery } from "../../../packages/database/src/index.js";
import { DomainError } from "../../../packages/domain/src/errors.js";
import type { Auth } from "./auth.js";
import { productRouter } from "./routes.js";
import type { Logger } from "pino";
import { AIService, type AIRuntime } from "../../../packages/domain/src/ai.js";
import { aiRouter } from "./ai-routes.js";
import {
  notificationRouter,
  notificationWebhooks,
} from "./notification-routes.js";
import type { MessagingConfig } from "../../../packages/domain/src/notification-provider.js";

import { agentRouter } from "./agent-routes.js";
import { approvalRouter } from "./approval-routes.js";
import { planningRouter } from "./planning-routes.js";
import { calendarRouter } from "./calendar-routes.js";
import { CalendarService } from "../../../packages/domain/src/calendar.js";

export function createApp(dependencies: {
  checkReady: () => Promise<void>;
  logger: Logger;
  db?: Kysely<Database>;
  auth?: Auth;
  webDirectory?: string;
  ai?: AIRuntime;
  messaging?: MessagingConfig;
  calendar?: CalendarService;
  origin?: string;
  trustProxyHops?: number;
  demoMode?: boolean;
}) {
  const app = express();
  // Enable only behind a host that overwrites forwarding headers (Render).
  app.set("trust proxy", dependencies.trustProxyHops === 1 ? 1 : false);
  app.disable("x-powered-by");
  app.use(
    helmet({
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        directives: { "upgrade-insecure-requests": null },
      },
    }),
  );
  app.use((_req, res, next) => {
    // Generate locally: attacker-supplied IDs may contain private data or log injection.
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const start = performance.now();
    res.on("finish", () =>
      dependencies.logger.info({
        event: "http_response",
        requestId,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - start),
      }),
    );
    next();
  });
  app.get("/health/live", (_req, res) => {
    res.json({ status: "alive" });
  });
  app.get("/health/ready", async (_req, res) => {
    try {
      await dependencies.checkReady();
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Service is not ready.",
          requestId: res.locals.requestId,
        },
      });
    }
  });
  app.get("/auth/status", (_req, res) =>
    res.json({
      configured: Boolean(dependencies.auth),
      demoMode: Boolean(dependencies.demoMode),
    }),
  );
  const messaging = dependencies.messaging || {
    mode: "mock" as const,
    sandbox: true,
  };
  if (dependencies.demoMode && messaging.mode !== "mock")
    throw new Error("Demo mode requires simulated notifications.");
  if (dependencies.db)
    app.use("/webhooks", notificationWebhooks(dependencies.db, messaging));
  if (dependencies.auth && dependencies.db) {
    app.use(dependencies.auth.middleware);
    app.use("/auth", dependencies.auth.router);
    app.use(
      "/api",
      rateLimit({
        windowMs: 60000,
        limit: 300,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (_req, _res, next) =>
          next(
            new DomainError(
              "RATE_LIMITED",
              429,
              "Too many requests. Try again shortly.",
            ),
          ),
      }),
    );
    app.use(
      "/api/v1",
      dependencies.auth.protect,
      async (_req, _res, next) => {
        try {
          await checkRecovery(dependencies.db!);
          next();
        } catch {
          next(
            new DomainError(
              "RECOVERY_HOLD",
              503,
              "AXIS is held for recovery review. Contact the operator.",
            ),
          );
        }
      },
      express.json({ limit: "32kb" }),
      calendarRouter(
        dependencies.calendar ?? new CalendarService(dependencies.db),
        dependencies.origin ?? "http://localhost:3000",
      ),
      notificationRouter(dependencies.db, messaging),
      approvalRouter(dependencies.db),
      agentRouter(dependencies.db, dependencies.demoMode),
      planningRouter(
        dependencies.db,
        new AIService(dependencies.db, dependencies.ai),
      ),
      aiRouter(
        new AIService(dependencies.db, dependencies.ai),
        dependencies.logger,
        dependencies.db,
      ),
      productRouter(
        dependencies.db,
        messaging.mode === "live" ? "live" : "mock_only",
      ),
    );
  }
  app.use("/api", (_req, res) => {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Authentication is not configured.",
        requestId: res.locals.requestId,
      },
    });
  });
  if (
    dependencies.webDirectory &&
    existsSync(resolve(dependencies.webDirectory, "index.html"))
  ) {
    app.use(express.static(dependencies.webDirectory, { index: false }));
    app.get("/", (_req, res) =>
      res.sendFile(resolve(dependencies.webDirectory!, "index.html")),
    );
  } else {
    app.get("/", (_req, res) =>
      res.json({
        service: "AXIS API",
        message:
          "Open the Vercel frontend to use AXIS. Check /health/ready for database readiness.",
        frontend: dependencies.origin ?? null,
      }),
    );
  }
  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found.",
        requestId: res.locals.requestId,
      },
    });
  });
  const handleError: express.ErrorRequestHandler = (
    error,
    _req,
    res,
    _next,
  ) => {
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof ZodError
          ? "VALIDATION_ERROR"
          : error?.code === "23503"
            ? "CONFLICT"
            : error?.type === "entity.too.large"
              ? "PAYLOAD_TOO_LARGE"
              : error instanceof SyntaxError
                ? "VALIDATION_ERROR"
                : "INTERNAL_ERROR";
    const status =
      error instanceof DomainError
        ? error.status
        : code === "VALIDATION_ERROR"
          ? 400
          : code === "CONFLICT"
            ? 409
            : code === "PAYLOAD_TOO_LARGE"
              ? 413
              : 500;
    const message =
      error instanceof DomainError
        ? error.message
        : code === "VALIDATION_ERROR"
          ? "Check the fields and try again."
          : code === "CONFLICT"
            ? "This record is still linked to other records."
            : code === "PAYLOAD_TOO_LARGE"
              ? "Request is too large."
              : "Something went wrong. Try again.";
    res
      .status(status)
      .json({ error: { code, message, requestId: res.locals.requestId } });
  };
  app.use(handleError);
  return app;
}
