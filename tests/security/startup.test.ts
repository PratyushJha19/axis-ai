import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";

test("invalid AI encryption fails startup with a safe configuration diagnostic", async () => {
  const secret = "synthetic-invalid-master-secret";
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "services/api/src/main.ts"],
    {
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://synthetic:synthetic@127.0.0.1:1/axis_test_startup",
        AI_CREDENTIALS_ENCRYPTION_KEY: secret,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 1);
    assert.match(output, /Invalid AI encryption/);
    assert.ok(!output.includes(secret));
    assert.doesNotMatch(output, /api_started/);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
});

test(
  "occupied API port fails without reporting successful startup",
  { timeout: 15000 },
  async () => {
    const blocker = createServer();
    blocker.listen(0, "127.0.0.1");
    await once(blocker, "listening");
    const address = blocker.address();
    assert.ok(address && typeof address !== "string");
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "services/api/src/main.ts"],
      {
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://synthetic:synthetic@127.0.0.1:1/axis_test_startup",
          PORT: String(address.port),
          GOOGLE_CLIENT_ID: "",
          GOOGLE_CLIENT_SECRET: "",
          OWNER_EMAIL: "",
          SESSION_SECRET: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [code] = await once(child, "close");
      assert.equal(code, 1);
      assert.match(output, /Port is already in use/);
      assert.doesNotMatch(output, /api_started|synthetic/);
    } finally {
      clearTimeout(timer);
      child.kill();
      blocker.close();
    }
  },
);
