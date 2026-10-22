import { readConfig } from "../packages/config/src/index.js";
import { createLogger } from "../packages/observability/src/index.js";
import { runProcessGroup } from "./process-group.js";
import { messagingConfig } from "../packages/domain/src/notification-provider.js";

const logger = createLogger();
try {
  const config = readConfig();
  if (!config.DEMO_MODE) throw new Error("Free host requires demo mode.");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const commands = [["--import", "tsx", "services/api/src/main.ts"]];
    if (config.FREE_HOST_NOTIFICATIONS)
      commands.push(["--import", "tsx", "services/worker/src/main.ts"]);
    if (config.FREE_HOST_NOTIFICATIONS && messagingConfig().telegramCommands)
      commands.push([
        "--import",
        "tsx",
        "services/worker/src/telegram-main.ts",
      ]);
    logger.info({
      event: "free_host_started",
      notificationWorker: config.FREE_HOST_NOTIFICATIONS,
    });
    process.exitCode = await runProcessGroup(commands, controller.signal);
    logger.info({ event: "free_host_stopped", failed: process.exitCode !== 0 });
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
} catch {
  logger.error({
    event: "free_host_startup_failed",
    reason: "Check free-host configuration.",
  });
  process.exitCode = 1;
}
