import { setTimeout } from "node:timers/promises";
import { readConfig } from "../../../packages/config/src/index.js";
import { createDatabase } from "../../../packages/database/src/index.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { readAIConfig } from "../../../packages/domain/src/ai-crypto.js";
import { groqAdapter } from "../../../packages/domain/src/ai-provider.js";
import { AIService } from "../../../packages/domain/src/ai.js";
import { messagingConfig } from "../../../packages/domain/src/notification-provider.js";
import { TelegramCommandWorker } from "./telegram-commands.js";

const logger = createLogger(),
  controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
  const config = readConfig(),
    messaging = messagingConfig();
  if (
    (config.DEMO_MODE && !config.FREE_HOST_NOTIFICATIONS) ||
    !messaging.telegramCommands ||
    !messaging.telegram
  )
    throw new Error("Unavailable");
  const db = createDatabase(config.DATABASE_URL),
    ai = readAIConfig();
  const worker = new TelegramCommandWorker(
    db,
    messaging.telegram,
    new AIService(
      db,
      ai ? { ...ai, adapter: groqAdapter(ai.timeout) } : undefined,
    ),
  );
  logger.info({ event: "telegram_command_worker_started" });
  try {
    while (!controller.signal.aborted) {
      try {
        await worker.runOnce();
      } catch {
        logger.warn({ event: "telegram_command_worker_unavailable" });
      }
      await setTimeout(1000, undefined, { signal: controller.signal }).catch(
        () => undefined,
      );
    }
  } finally {
    await db.destroy();
  }
} catch {
  logger.error({ event: "telegram_command_worker_startup_failed" });
  process.exitCode = 1;
}
