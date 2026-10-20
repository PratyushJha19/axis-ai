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
  assert.equal(config.HOST, "127.0.0.1");
  assert.equal(config.TRUST_PROXY_HOPS, 0);
  assert.equal(config.DEMO_MODE, false);
});

test("cloud settings require explicit public binding, bounded proxy trust and strict demo flag", () => {
  const base = { DATABASE_URL: "postgres://localhost/axis" };
  assert.equal(
    readConfig({
      ...base,
      HOST: "0.0.0.0",
      DEMO_MODE: "true",
      TRUST_PROXY_HOPS: "1",
    }).DEMO_MODE,
    true,
  );
  for (const extra of [
    { HOST: "untrusted.invalid" },
    { TRUST_PROXY_HOPS: "true" },
    { TRUST_PROXY_HOPS: "2" },
    { DEMO_MODE: "yes" },
  ])
    assert.throws(
      () => readConfig({ ...base, ...extra }),
      /Invalid configuration/,
    );
});
