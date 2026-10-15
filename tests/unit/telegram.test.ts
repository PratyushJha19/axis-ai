import assert from "node:assert/strict";
import test from "node:test";
import {
  channelAdapters,
  deliveryCall,
  messagingConfig,
  type OutboundNotification,
} from "../../packages/domain/src/notification-provider.js";
const config = messagingConfig({
  NOTIFICATION_MODE: "live",
  TELEGRAM_BOT_TOKEN: `123456:${"x".repeat(32)}`,
  TELEGRAM_BOT_USERNAME: "axis_test_bot",
});
const input: OutboundNotification = {
  key: "key",
  jobId: "job",
  botId: "123456",
  destination: "7890",
  title: "<private title>",
  body: "body",
  due: "2026-10-15T12:00:00Z",
  timezone: "Asia/Kolkata",
  reminderId: null,
  windowUntil: null,
};
test("Telegram needs no public origin, paid broadcasting is off, success is sent not delivered", async () => {
  assert.equal(config.publicOrigin, undefined);
  const adapter = channelAdapters(config, async (url, options) => {
    assert.equal(
      String(url),
      `https://api.telegram.org/bot${config.telegram!.token}/sendMessage`,
    );
    assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.chat_id, "7890");
    assert.equal(body.allow_paid_broadcast, false);
    assert.equal(body.parse_mode, undefined);
    assert.ok(body.text.includes("<private title>"));
    return Response.json({
      ok: true,
      result: { message_id: 12, chat: { id: 7890, type: "private" } },
    });
  }).telegram;
  assert.deepEqual(await adapter.send(input, new AbortController().signal), {
    status: "sent",
    messageId: "123456:7890:12",
  });
  assert.equal(
    (await adapter.reconcile("123456:7890:12", new AbortController().signal))
      .status,
    "unknown",
  );
});
test("Telegram mock and changed bot identity cannot dispatch", async () => {
  assert.equal(
    messagingConfig({
      NOTIFICATION_MODE: "live",
      TWILIO_SANDBOX_ACCOUNT_SID: "retired",
      TWILIO_SANDBOX_AUTH_TOKEN: "retired",
      TWILIO_SANDBOX_WHATSAPP_FROM: "retired",
    }).twilio,
    undefined,
  );
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    throw Error("must not call");
  };
  assert.equal(
    (
      await channelAdapters(
        { mode: "mock", sandbox: true },
        fetcher,
      ).telegram.send(input, new AbortController().signal)
    ).status,
    "failed",
  );
  assert.equal(
    (
      await channelAdapters(config, fetcher).telegram.send(
        { ...input, botId: "654321" },
        new AbortController().signal,
      )
    ).category,
    "configuration",
  );
  assert.equal(calls, 0);
});
test("Telegram explicit rate limit retries; forbidden is permanent/configuration; failures and malformed success stay unknown", async () => {
  for (const [status, data, expected] of [
    [
      429,
      { ok: false, error_code: 429, parameters: { retry_after: 42 } },
      "rate_limit",
    ],
    [403, { ok: false }, "configuration"],
    [500, { ok: false }, "unknown"],
    [200, { ok: true, result: {} }, "unknown"],
  ] as const) {
    const adapter = channelAdapters(config, async () =>
      Response.json(data, { status }),
    ).telegram;
    const result = await deliveryCall((signal) => adapter.send(input, signal));
    assert.equal(result.category, expected);
    if (status === 429) assert.equal(result.retryAfterMs, 42000);
  }
});
test("Telegram destination mismatch and network loss never claim success or leak token", async () => {
  const adapter = channelAdapters(config, async () =>
    Response.json({
      ok: true,
      result: { message_id: 1, chat: { id: 1, type: "private" } },
    }),
  ).telegram;
  assert.equal(
    (await deliveryCall((s) => adapter.send(input, s))).status,
    "unknown",
  );
  const failed = channelAdapters(config, async () => {
    throw Error(`secret ${config.telegram!.token}`);
  }).telegram;
  const outcome = await deliveryCall((s) => failed.send(input, s));
  assert.equal(outcome.status, "unknown");
  assert.ok(!JSON.stringify(outcome).includes(config.telegram!.token));
});
