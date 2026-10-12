import assert from "node:assert/strict";
import test from "node:test";
import {
  taskSchema,
  memorySchema,
  timezoneSchema,
  listSchema,
} from "../../packages/shared/src/contracts.js";
import { readAuthConfig } from "../../services/api/src/auth.js";

test("strict contracts reject ownership injection, ambiguous times and invalid search bounds", () => {
  assert.equal(
    taskSchema.safeParse({ title: "Task", user_id: "injected" }).success,
    false,
  );
  assert.equal(
    taskSchema.safeParse({ title: "Task", due_at: "2026-10-10T10:00:00Z" })
      .success,
    false,
  );
  assert.equal(
    taskSchema.safeParse({
      title: "Task",
      due_at: "2026-10-10T10:00:00Z",
      due_timezone: "Asia/Kolkata",
    }).success,
    true,
  );
  assert.equal(
    memorySchema.safeParse({
      content: "Context",
      sensitivity: "ordinary",
      scope: "project",
    }).success,
    false,
  );
  assert.equal(timezoneSchema.safeParse("Invalid/Zone").success, false);
  assert.equal(listSchema.safeParse({ limit: 1000 }).success, false);
});
test("Google configuration is optional only when absent and rejects insecure remote origins", () => {
  assert.equal(readAuthConfig({}), undefined);
  assert.throws(
    () => readAuthConfig({ GOOGLE_CLIENT_ID: "partial" }),
    /Incomplete/,
  );
  const values = {
    GOOGLE_CLIENT_ID: "test",
    GOOGLE_CLIENT_SECRET: "synthetic",
    SESSION_SECRET: "x".repeat(48),
  };
  assert.equal(readAuthConfig(values)?.origin, "http://localhost:3000");
  assert.deepEqual(
    readAuthConfig({ ...values, OWNER_EMAIL: "legacy@example.invalid" }),
    readAuthConfig(values),
  );
  assert.equal(
    readAuthConfig({ OWNER_EMAIL: "legacy@example.invalid" }),
    undefined,
  );
  assert.throws(
    () => readAuthConfig({ ...values, APP_ORIGIN: "http://public.invalid" }),
    /Invalid/,
  );
  assert.throws(
    () =>
      readAuthConfig({ ...values, APP_ORIGIN: "https://public.invalid/path" }),
    /Invalid/,
  );
});
