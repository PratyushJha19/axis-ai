import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../../services/api/src/app.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

test("API-only hosting serves a useful root without a frontend build", async () => {
  for (const webDirectory of [undefined, resolve(".local", randomUUID())]) {
    const app = createApp({
      logger: createLogger("silent"),
      checkReady: async () => {
        throw new Error("synthetic unavailable");
      },
      webDirectory,
      origin: "https://axis-demo.example",
    });
    const root = await request(app).get("/").expect(200);
    assert.equal(root.body.service, "AXIS API");
    assert.equal(root.body.frontend, "https://axis-demo.example");
    await request(app).get("/health/ready").expect(503);
    await request(app).get("/api/v1/tasks").expect(401);
  }
});

test("demo status is public but live notification configuration is rejected", async () => {
  const deps = {
    logger: createLogger("silent"),
    checkReady: async () => undefined,
    demoMode: true,
  };
  const status = await request(createApp(deps)).get("/auth/status").expect(200);
  assert.equal(status.body.demoMode, true);
  assert.equal(status.headers["cache-control"], "no-store");
  assert.throws(
    () => createApp({ ...deps, messaging: { mode: "live", sandbox: true } }),
    /simulated/,
  );
  assert.equal(createApp(deps).get("trust proxy"), false);
});

test("health, fail-closed API, and private input handling", async () => {
  let logs = "";
  let ready = true;
  const app = createApp({
    logger: createLogger("info", {
      write: (text: string) => {
        logs += text;
      },
    }),
    checkReady: async () => {
      if (!ready) throw new Error("synthetic-private-error");
    },
  });
  const live = await request(app)
    .get("/health/live?token=synthetic-private-query")
    .set("Authorization", "Bearer synthetic-private-auth")
    .set("X-Request-Id", "synthetic-private-id")
    .expect(200);
  assert.equal(live.body.status, "alive");
  assert.match(String(live.headers["x-request-id"]), /^[0-9a-f-]{36}$/);
  await request(app).get("/health/ready").expect(200);
  ready = false;
  const unavailable = await request(app).get("/health/ready").expect(503);
  assert.equal(unavailable.body.error.code, "DEPENDENCY_UNAVAILABLE");
  assert.equal(
    unavailable.body.error.requestId,
    unavailable.headers["x-request-id"],
  );
  await request(app).get("/health/live").expect(200);
  for (const route of [
    "/api/v1/tasks",
    "/api/v1/actions/example/execute",
    "/api/v1/approvals/example/approve",
  ]) {
    const response = await request(app)
      .post(route)
      .send({ content: "synthetic-private-body" })
      .expect(401);
    assert.equal(response.body.error.code, "UNAUTHENTICATED");
  }
  await request(app).get("/synthetic-private-path").expect(404);
  assert.ok(!logs.includes("synthetic-private"));
  assert.ok(!JSON.stringify(unavailable.body).includes("synthetic-private"));
  for (const line of logs.trim().split("\n")) {
    const entry = JSON.parse(line);
    assert.equal(entry.event, "http_response");
    assert.ok(entry.requestId);
  }
});
