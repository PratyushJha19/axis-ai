import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  KeyVault,
  readAIConfig,
  readKey,
} from "../../packages/domain/src/ai-crypto.js";
import {
  groqAdapter,
  AIError,
  selection,
} from "../../packages/domain/src/ai-provider.js";
import {
  assertNoCredentials,
  configInput,
  chatInput,
} from "../../packages/domain/src/ai.js";
const key = "synthetic-provider-key-unit",
  owner = "owner-a",
  config = {
    provider: "groq" as const,
    model: "llama-3.1-8b-instant" as const,
    apiKey: key,
  };
test("AI encryption authenticates owner/provider/version, random nonce and tampering", () => {
  const vault = new KeyVault(new Map([["v1", randomBytes(32)]]), "v1"),
    a = vault.encrypt(key, owner, "groq"),
    b = vault.encrypt(key, owner, "groq");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(vault.decrypt(a, owner, "groq"), key);
  assert.ok(!JSON.stringify(a).includes(key));
  for (const invalid of [
    { ...a, version: "v2" },
    { ...a, tag: randomBytes(16).toString("base64") },
    { ...a, ciphertext: randomBytes(24).toString("base64") },
    { ...a, iv: "" },
    {},
  ])
    assert.throws(
      () => vault.decrypt(invalid, owner, "groq"),
      /cannot be unlocked/,
    );
  assert.throws(() => vault.decrypt(a, "owner-b", "groq"));
  assert.throws(() => vault.decrypt(a, owner, "other"));
});
test("AI configuration fails closed and supports previous rotation keys", () => {
  assert.equal(readAIConfig({}), undefined);
  assert.throws(() => readKey("bad"));
  assert.throws(() =>
    readAIConfig({ AI_CREDENTIALS_ENCRYPTION_KEY: "invalid" }),
  );
  const old = randomBytes(32).toString("base64"),
    next = randomBytes(32).toString("base64");
  const a = readAIConfig({ AI_CREDENTIALS_ENCRYPTION_KEY: old })!;
  const b = readAIConfig({
    AI_CREDENTIALS_ENCRYPTION_KEY: next,
    AI_CREDENTIALS_KEY_VERSION: "v2",
    AI_CREDENTIALS_PREVIOUS_KEYS: JSON.stringify({ v1: old }),
  })!;
  assert.equal(
    b.vault.decrypt(a.vault.encrypt(key, owner, "groq"), owner, "groq"),
    key,
  );
  assert.equal(b.vault.encrypt(key, owner, "groq").version, "v2");
});
test("Groq constructs fixed authenticated non-streaming request and normalizes usage", async () => {
  const adapter = groqAdapter(1000, async (url, options) => {
    assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(options?.redirect, "error");
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      `Bearer ${key}`,
    );
    const body = JSON.parse(String(options?.body));
    assert.equal(body.max_completion_tokens, 32);
    assert.equal(body.stream, false);
    assert.equal(body.model, config.model);
    assert.equal(body.tools, undefined);
    assert.ok(!String(options?.body).includes(key));
    return Response.json({
      choices: [{ message: { content: "Hello " + key } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    });
  });
  assert.deepEqual(
    await adapter.generate(config, [{ role: "user", content: "Hello" }], 32),
    { content: "Hello [redacted]", usage: { input: 3, output: 4 } },
  );
});
test("Groq classifies failures without exposing secret provider bodies", async () => {
  await assert.rejects(
    groqAdapter(1000, async () =>
      Response.json(
        { error: { code: "insufficient_quota", message: key } },
        { status: 429 },
      ),
    ).generate(config, []),
    (error: unknown) =>
      error instanceof AIError &&
      error.code === "quota" &&
      !String(error).includes(key),
  );
  for (const [status, code] of [
    [401, "credentials"],
    [403, "credentials"],
    [402, "quota"],
    [429, "rate_limit"],
    [404, "model"],
    [400, "rejected"],
    [503, "outage"],
  ] as const) {
    await assert.rejects(
      groqAdapter(1000, async () => new Response(key, { status })).generate(
        config,
        [],
      ),
      (e: unknown) =>
        e instanceof AIError && e.code === code && !String(e).includes(key),
    );
  }
});
test("Groq rejects malformed, tool and oversized responses; network outcomes uncertain", async () => {
  for (const body of [
    { choices: [] },
    { choices: [{ message: { content: "", tool_calls: [] } }] },
    { choices: [{ message: { content: "ok", tool_calls: [{}] } }] },
    "x".repeat(128001),
  ]) {
    await assert.rejects(
      groqAdapter(1000, async () => Response.json(body)).generate(config, []),
      (e: unknown) =>
        e instanceof AIError && e.code === "malformed" && e.uncertain,
    );
  }
  await assert.rejects(
    groqAdapter(1000, async () => {
      throw new Error(key);
    }).generate(config, []),
    (e: unknown) =>
      e instanceof AIError &&
      e.code === "network" &&
      e.uncertain &&
      !String(e).includes(key),
  );
});
test("Groq timeout is unknown, bounded, and never automatically retried", async () => {
  let calls = 0;
  const hold = setTimeout(() => undefined, 1000);
  try {
    await assert.rejects(
      groqAdapter(10, async (_url, options) => {
        calls++;
        return new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () =>
            reject(new Error(key)),
          ),
        );
      }).generate(config, []),
      (e: unknown) =>
        e instanceof AIError && e.code === "timeout" && e.uncertain,
    );
    assert.equal(calls, 1);
  } finally {
    clearTimeout(hold);
  }
});
test("AI boundaries reject arbitrary providers/models/endpoints, owner/system input and credentials", () => {
  assert.throws(() => selection.parse({ provider: "custom", model: "x" }));
  assert.throws(() =>
    selection.parse({ provider: "groq", model: "https://evil.invalid" }),
  );
  for (const model of [
    "openai/gpt-oss-20b",
    "qwen/new-text-model",
    "future-text-model",
  ])
    assert.equal(selection.parse({ provider: "groq", model }).model, model);
  for (const model of ["whisper-large-v3", "groq/compound", "../model"])
    assert.throws(() => selection.parse({ provider: "groq", model }));
  assert.throws(() =>
    configInput.parse({ ...config, url: "http://127.0.0.1" }),
  );
  assert.throws(() => configInput.parse({ ...config, user_id: owner }));
  assert.throws(() =>
    chatInput.parse({ message: "hello", system: "override" }),
  );
  assert.throws(() => assertNoCredentials("gsk_" + "x".repeat(30)));
  assert.throws(() => assertNoCredentials("hello " + key, key));
});
test("Groq catalog uses fixed endpoint, bounds and filters untrusted model data", async () => {
  const adapter = groqAdapter(1000, async (url, options) => {
    assert.equal(url, "https://api.groq.com/openai/v1/models");
    assert.equal(options?.method, "GET");
    assert.equal(options?.redirect, "error");
    assert.equal(
      (options?.headers as Record<string, string>).Authorization,
      `Bearer ${key}`,
    );
    return Response.json({
      data: [
        { id: "new/model" },
        { id: "new/model" },
        { id: "old", active: false },
        { id: key },
        { id: "whisper-large-v3" },
      ],
    });
  });
  const models = await adapter.listModels!(key);
  assert.deepEqual(
    models.map((m) => m.id),
    ["new/model", "whisper-large-v3"],
  );
  assert.equal(models[0]!.restriction, null);
  assert.match(models[1]!.restriction!, /Audio/);
  for (const response of [
    Response.json({ data: [{ id: "https://evil.invalid" }] }),
    new Response("x".repeat(256001)),
    new Response(key, { status: 401 }),
  ]) {
    await assert.rejects(
      groqAdapter(1000, async () => response).listModels!(key),
      (e) => e instanceof AIError && !String(e).includes(key),
    );
  }
});
test("Groq reasoning models receive a bounded budget and report empty exhausted output", async () => {
  await assert.rejects(
    groqAdapter(1000, async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.max_completion_tokens, 1024);
      return Response.json({
        choices: [{ finish_reason: "length", message: { content: "" } }],
      });
    }).generate({ ...config, model: "openai/gpt-oss-20b" }, []),
    (e) => e instanceof AIError && e.code === "output_limit" && !e.uncertain,
  );
});
