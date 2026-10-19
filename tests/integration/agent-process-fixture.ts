// Synthetic process-loss harness; never imported by production.
import assert from "node:assert/strict";
import { createDatabase } from "../../packages/database/src/index.js";
import { AIService } from "../../packages/domain/src/ai.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";
import { AgentRuntime } from "../../services/worker/src/agent-runtime.js";
import { createLogger } from "../../packages/observability/src/index.js";
const connection = process.env.TEST_DATABASE_URL!;
const url = new URL(connection);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.match(url.pathname, /^\/axis_test_[a-z0-9_]+$/);
const stage = process.argv[2];
assert.ok(["model", "proposal", "read"].includes(stage!));
const db = createDatabase(connection);
const ai = new AIService(db, {
  rate: 100,
  vault: new KeyVault(
    new Map([["v1", Buffer.from(process.env.AXIS_TEST_AGENT_KEY!, "base64")]]),
    "v1",
  ),
  adapter: {
    agentProtocol: "json-text",
    async generate() {
      if (stage === "model") process.exit(23);
      return {
        content: JSON.stringify({
          kind: "tools",
          calls: [
            stage === "proposal"
              ? {
                  name: "create_task",
                  arguments: { title: "Process fixture task" },
                }
              : { name: "search_tasks", arguments: {} },
          ],
        }),
        usage: null,
      };
    },
  },
});
await new AgentRuntime(db, ai, createLogger("silent")).runOnce();
process.exit(23);
