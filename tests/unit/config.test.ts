import assert from "node:assert/strict";
import test from "node:test";
import { readConfig } from "../../packages/config/src/index.js";

test("configuration requires PostgreSQL and validates port without leaking values", () => {
  for (const env of [
    {},
    { DATABASE_URL: "https://private.invalid" },
    { DATABASE_URL: "postgres://localhost/axis", PORT: "-1" },
  ]) {
    assert.throws(() => readConfig(env), /^Error: Invalid configuration\./);
  }
  assert.equal(
    readConfig({ DATABASE_URL: "postgres://localhost/axis" }).PORT,
    3000,
  );
});

test("blank optional template entries use safe defaults", () => {
  const config = readConfig({
    DATABASE_URL: "postgres://localhost/axis",
    PORT: "",
    LOG_LEVEL: "",
  });
  assert.equal(config.PORT, 3000);
  assert.equal(config.LOG_LEVEL, "info");
});
