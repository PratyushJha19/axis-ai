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
const server = createApp({
  db,
  auth,
  ai: {
    vault: new KeyVault(new Map([["test", randomBytes(32)]]), "test"),
    rate: 20,
    adapter: {
      async generate(config, messages) {
        if (config.apiKey === "synthetic-invalid-key")
          throw new AIError("credentials");
        const message = messages.at(-1)?.content;
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
  },
  logger: createLogger("silent"),
  checkReady: () => checkDatabase(db),
  webDirectory: resolve("apps/web/dist"),
}).listen(33018, "127.0.0.1");
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
    worker.kill();
    server.close(() => {
      void Promise.all([auth.close(), db.destroy()]);
    });
  });
