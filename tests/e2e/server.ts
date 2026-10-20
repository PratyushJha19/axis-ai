import { AIService, type AIRuntime } from "../../packages/domain/src/ai.js";
import { AgentRuntime } from "../../services/worker/src/agent-runtime.js";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  createDatabase,
  checkDatabase,
} from "../../packages/database/src/index.js";
import { createMigrator } from "../../database/scripts/migrator.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { createApp } from "../../services/api/src/app.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";
import { AIError } from "../../packages/domain/src/ai-provider.js";
import { CalendarService } from "../../packages/domain/src/calendar.js";
import { calendarScope } from "../../packages/domain/src/calendar-provider.js";
import {
  createAuth,
  type IdentityProvider,
} from "../../services/api/src/auth.js";

const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error("Isolated test database required.");
const url = new URL(connectionString);
if (
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  !/^\/axis_test_e2e_[a-z0-9_]+$/.test(url.pathname)
)
  throw new Error("Refusing a non-test database.");
const db = createDatabase(connectionString);
const migration = await createMigrator(db).migrateToLatest();
if (migration.error) throw new Error("Test migration failed.");
const origin = "http://localhost:33018";
// This fake provider exists ONLY in the test harness. Production has no bypass flag or test route.
const provider: IdentityProvider = {
  async begin() {
    const state = randomUUID();
    return {
      url: `${origin}/auth/google/callback?state=${state}&code=synthetic`,
      challenge: { state, nonce: randomUUID(), verifier: randomUUID() },
    };
  },
  async verify(url) {
    const second = url.searchParams.get("code") === "synthetic-b";
    return {
      subject: second ? "synthetic-ui-b" : "synthetic-ui-owner",
      email: second ? "b@example.invalid" : "owner@example.invalid",
      verified: true,
      name: second ? "Blair" : "Alex",
    };
  },
};
const auth = createAuth(
  db,
  connectionString,
  {
    origin,
    secret: randomBytes(48).toString("hex"),
    clientId: "synthetic",
    clientSecret: "synthetic",
  },
  provider,
);
let rateFailureSent = false;
const aiRuntime: AIRuntime = {
  vault: new KeyVault(new Map([["test", randomBytes(32)]]), "test"),
  rate: 20,
  adapter: {
    agentProtocol: "json-text",
    async listModels() {
      return [
        { id: "openai/gpt-oss-20b", restriction: null },
        {
          id: "whisper-large-v3",
          restriction: "Audio model — text chat only.",
        },
      ];
    },
    async generate(config, messages) {
      if (config.apiKey === "synthetic-invalid-key")
        throw new AIError("credentials");
      if (messages[0]?.content.includes("Maximum four independent reads")) {
        const done = messages.some((m) =>
          m.content.startsWith("Verified M4 result"),
        );
        return {
          content: JSON.stringify(
            done
              ? {
                  kind: "final",
                  message: "The recorded task result is available.",
                }
              : {
                  kind: "tools",
                  calls: [
                    {
                      name: "create_task",
                      arguments: { title: "Agent browser task" },
                    },
                  ],
                },
          ),
          usage: { input: 10, output: 10 },
        };
      }
      const message = messages.at(-1)?.content;
      if (message === "Create a task to read the report")
        return {
          content: JSON.stringify({
            reply: "Draft",
            proposal: {
              kind: "task",
              title: "Read the report",
              description: "",
            },
          }),
          usage: null,
        };
      if (message === "Remind me on October 16 2099 at 9 am")
        return {
          content: JSON.stringify({
            reply: "Draft",
            proposal: {
              kind: "reminder",
              title: "Review report",
              local_due: "2099-10-16T09:00",
              recurrence: "none",
            },
          }),
          usage: null,
        };
      if (message === "fixture unknown") throw new AIError("timeout", true);
      if (message === "fixture rate limit" && !rateFailureSent) {
        rateFailureSent = true;
        throw new AIError("rate_limit");
      }
      return {
        content:
          "Synthetic browser response. No real provider was contacted. <img src=x onerror=alert(1)>",
        usage: { input: 4, output: 8 },
      };
    },
  },
};
const server = createApp({
  db,
  auth,
  ai: aiRuntime,
  origin,
  calendar: new CalendarService(db, {
    vault: aiRuntime.vault,
    provider: {
      async begin() {
        const state = randomUUID();
        return {
          url: `${origin}/api/v1/calendar/callback?state=${state}&code=synthetic`,
          challenge: { state, nonce: randomUUID(), verifier: randomUUID() },
        };
      },
      async exchange() {
        return {
          subject: "synthetic-ui-owner",
          refresh: "synthetic-calendar-token",
          scopes: [calendarScope],
        };
      },
      async events(_refresh, start) {
        const end = new Date(Date.parse(start) + 3600000).toISOString();
        return [
          {
            id: "ui-event",
            title: "Synthetic Google commitment",
            start,
            end,
            timezone: "UTC",
            busy: true,
            all_day: false,
          },
        ];
      },
      async revoke() {
        return true;
      },
    },
  }),
  logger: createLogger("silent"),
  checkReady: () => checkDatabase(db),
  webDirectory: resolve("apps/web/dist"),
}).listen(33018, "127.0.0.1");
const agent = new AgentRuntime(
  db,
  new AIService(db, aiRuntime),
  createLogger("silent"),
);
let agentBusy = false;
const agentTimer = setInterval(() => {
  if (!agentBusy) {
    agentBusy = true;
    void agent
      .runOnce()
      .catch(() => undefined)
      .finally(() => {
        agentBusy = false;
      });
  }
}, 100);
const worker = spawn(
  process.execPath,
  ["--import", "tsx", "services/worker/src/main.ts"],
  {
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      LOG_LEVEL: "silent",
    },
    stdio: "ignore",
  },
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    clearInterval(agentTimer);
    worker.kill();
    server.close(() => {
      void Promise.all([auth.close(), db.destroy()]);
    });
  });
