import { readConfig } from "../../../packages/config/src/index.js";
import {
  createDatabase,
  checkDatabase,
} from "../../../packages/database/src/index.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { createApp } from "./app.js";
import { resolve } from "node:path";
import { createAuth, readAuthConfig } from "./auth.js";
import { readAIConfig } from "../../../packages/domain/src/ai-crypto.js";
import { groqAdapter } from "../../../packages/domain/src/ai-provider.js";
import { messagingConfig } from "../../../packages/domain/src/notification-provider.js";
import { CalendarService } from "../../../packages/domain/src/calendar.js";
import { googleCalendarProvider } from "../../../packages/domain/src/calendar-provider.js";

const logger = createLogger();
let startupPhase = "base";
try {
  const config = readConfig();
  startupPhase = "ai";
  const aiConfig = readAIConfig();
  startupPhase = "base";
  if (!aiConfig)
    logger.info({
      event: "ai_disabled",
      reason: "AI_CREDENTIALS_ENCRYPTION_KEY is not configured.",
    });
  logger.level = config.LOG_LEVEL;
  const db = createDatabase(config.DATABASE_URL);
  const authConfig = readAuthConfig(process.env);
  const auth = authConfig
    ? createAuth(db, config.DATABASE_URL, authConfig)
    : undefined;
  const app = createApp({
    checkReady: () => checkDatabase(db),
    logger,
    db,
    auth,
    origin: authConfig?.origin,
    calendar: new CalendarService(
      db,
      authConfig && aiConfig
        ? {
            vault: aiConfig.vault,
            provider: googleCalendarProvider(authConfig),
          }
        : undefined,
    ),
    messaging: messagingConfig(),
    ai: aiConfig
      ? { ...aiConfig, adapter: groqAdapter(aiConfig.timeout) }
      : undefined,
    webDirectory: resolve("apps/web/dist"),
  });
  const server = app.listen(config.PORT, "127.0.0.1");
  server.once("listening", () => {
    logger.info({ event: "api_started", port: config.PORT });
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    logger.error({
      event: "api_failed",
      reason:
        error.code === "EADDRINUSE"
          ? "Port is already in use. Stop the existing AXIS process before restarting."
          : "Unable to listen on the configured local port.",
      port: config.PORT,
    });
    process.exitCode = 1;
    void Promise.all([db.destroy(), auth?.close()]);
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 5000);
    timer.unref();
    server.close(() => {
      void Promise.all([db.destroy(), auth?.close()]).then(() => {
        clearTimeout(timer);
        logger.info({ event: "api_stopped" });
      });
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch {
  logger.error({
    event: "startup_failed",
    reason:
      startupPhase === "ai"
        ? "Invalid AI encryption key, key version, timeout or rate configuration. Check the AI environment settings."
        : "Check local configuration.",
  });
  process.exitCode = 1;
}
