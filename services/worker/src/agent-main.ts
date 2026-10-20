import { setTimeout } from "node:timers/promises";
import { readConfig } from "../../../packages/config/src/index.js";
import {
  createDatabase,
  checkDatabase,
} from "../../../packages/database/src/index.js";
import { createLogger } from "../../../packages/observability/src/index.js";
import { readAIConfig } from "../../../packages/domain/src/ai-crypto.js";
import { groqAdapter } from "../../../packages/domain/src/ai-provider.js";
import { AIService } from "../../../packages/domain/src/ai.js";
import { AgentRuntime, agentLimitsSchema } from "./agent-runtime.js";
const logger = createLogger(),
  controller = new AbortController();
process.on("SIGINT", () => controller.abort());
process.on("SIGTERM", () => controller.abort());
try {
  const config = readConfig(),
    aiConfig = readAIConfig();
  const db = createDatabase(config.DATABASE_URL);
  const runtime = new AgentRuntime(
    db,
    new AIService(
      db,
      aiConfig
        ? { ...aiConfig, adapter: groqAdapter(aiConfig.timeout) }
        : undefined,
    ),
    logger,
    agentLimitsSchema.parse(
      Object.fromEntries(
        Object.entries({
          iterations: "AGENT_MAX_ITERATIONS",
          tools: "AGENT_MAX_TOOLS",
          tokens: "AGENT_MAX_TOKENS",
          resultBytes: "AGENT_RESULT_BYTES",
          modelTimeoutMs: "AGENT_MODEL_TIMEOUT_MS",
        })
          .filter(([, name]) => process.env[name]?.trim())
          .map(([key, name]) => [key, Number(process.env[name])]),
      ),
    ),
  );
  try {
    await checkDatabase(db);
    logger.info({ event: "agent_worker_started" });
    while (!controller.signal.aborted) {
      try {
        await checkDatabase(db);
        await runtime.runOnce();
      } catch {
        logger.warn({ event: "agent_worker_dependency_unavailable" });
      }
      await setTimeout(1000, undefined, { signal: controller.signal }).catch(
        () => undefined,
      );
    }
  } finally {
    await db.destroy();
  }
} catch {
  logger.error({ event: "agent_worker_startup_failed" });
  process.exitCode = 1;
}
