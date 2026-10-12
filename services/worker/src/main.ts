import { setTimeout } from "node:timers/promises";
import { readConfig } from "../../../packages/config/src/index.js";
import {
  checkDatabase,
  createDatabase,
} from "../../../packages/database/src/index.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { ReminderEngine, workerPolicy } from "./engine.js";
import { mockProvider } from "./provider.js";
import { DeliveryEngine, outboxProvider } from "./delivery.js";
import {
  messagingConfig,
  channelAdapters,
} from "../../../packages/domain/src/notification-provider.js";

const logger = createLogger();
const controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
try {
  const config = readConfig();
  logger.level = config.LOG_LEVEL;
  const db = createDatabase(config.DATABASE_URL);
  try {
    const engine = new ReminderEngine(
      db,
      messagingConfig().mode === "live" ? outboxProvider(db) : mockProvider(db),
      logger,
      () => new Date(),
      workerPolicy(),
    );
    const messaging = messagingConfig();
    const delivery =
      messaging.mode === "live"
        ? new DeliveryEngine(
            db,
            channelAdapters(messaging),
            logger,
            () => new Date(),
            workerPolicy(),
          )
        : undefined;
    logger.info({ event: "worker_started", mode: messaging.mode });
    let ready: boolean | undefined;
    while (!controller.signal.aborted) {
      try {
        await checkDatabase(db);
        await engine.runOnce();
        await delivery?.runOnce();
        if (ready !== true)
          logger.info({
            event: "worker_dependency_ready",
            mode: messaging.mode,
          });
        ready = true;
      } catch {
        if (ready !== false)
          logger.warn({ event: "worker_dependency_unavailable" });
        ready = false;
      }
      await setTimeout(1000, undefined, { signal: controller.signal }).catch(
        () => undefined,
      );
    }
  } finally {
    await db.destroy();
  }
  logger.info({ event: "worker_stopped" });
} catch {
  logger.error({ event: "worker_startup_failed" });
  process.exitCode = 1;
}
