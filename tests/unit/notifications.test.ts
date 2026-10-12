import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { phoneSchema } from "../../packages/shared/src/notifications.js";
import {
  messagingConfig,
  channelAdapters,
  notificationContent,
  advanceStatus,
  twilioStatus,
  emailStatus,
  deliveryCall,
  type MessagingConfig,
  type OutboundNotification,
} from "../../packages/domain/src/notification-provider.js";

const config: MessagingConfig = {
  mode: "live",
  sandbox: true,
  publicOrigin: "https://axis.example.invalid",
  twilio: {
    account: `AC${"1".repeat(32)}`,
    token: "synthetic-private-token",
    from: "whatsapp:+15005550006",
  },
  email: {
    key: "synthetic-private-email-key",
    from: "axis@example.invalid",
    webhookSecret: "whsec_c3ludGhldGlj",
  },
};
const input: OutboundNotification = {
  key: "synthetic-key",
  jobId: randomUUID(),
  destination: "+15005550007",
  title: "<script>private</script>",
  body: "A & B",
  due: "2026-10-12T12:00:00Z",
  timezone: "Asia/Kolkata",
  reminderId: randomUUID(),
  windowUntil: new Date(Date.now() + 3600000).toISOString(),
};
test("notification settings require E.164 and isolate sandbox configuration", () => {
  assert.equal(phoneSchema.parse("+91 (98765) 43210"), "+919876543210");
  assert.equal(phoneSchema.safeParse("09876543210").success, false);
  assert.deepEqual(messagingConfig({}), { mode: "mock", sandbox: true });
  assert.equal(
    messagingConfig({
      NOTIFICATION_MODE: "live",
      TWILIO_PRODUCTION_ACCOUNT_SID: config.twilio!.account,
      TWILIO_PRODUCTION_AUTH_TOKEN: config.twilio!.token,
      TWILIO_PRODUCTION_WHATSAPP_FROM: config.twilio!.from,
    }).twilio,
    undefined,
  );
  assert.throws(() =>
    messagingConfig({
      NOTIFICATION_MODE: "live",
      NOTIFICATION_PUBLIC_ORIGIN: "https://attacker.invalid/path",
    }),
  );
});
test("notification content escapes HTML, localizes time and uses configured origin", () => {
  const content = notificationContent(input, config.publicOrigin);
  assert.ok(content.html.includes("&lt;script&gt;"));
  assert.ok(!content.html.includes("<script>"));
  assert.ok(content.text.includes("5:30"));
  assert.ok(content.html.includes("A &amp; B"));
  assert.ok(
    content.text.includes("https://axis.example.invalid/?view=reminders"),
  );
});
test("provider status mappings preserve delivery evidence", () => {
  assert.equal(twilioStatus("queued"), "accepted");
  assert.equal(twilioStatus("read"), "read");
  assert.equal(emailStatus("sent"), "sent");
  assert.equal(emailStatus("delivered"), "delivered");
  assert.equal(advanceStatus("delivered", "failed"), "delivered");
  assert.equal(advanceStatus("read", "sent"), "read");
  assert.equal(advanceStatus("sent", "accepted"), "sent");
  assert.equal(advanceStatus("failed", "delivered"), "delivered");
});
test("Twilio sends bounded form requests to a fixed endpoint and enforces template window", async () => {
  let calls = 0;
  const adapters = channelAdapters(config, async (url, init) => {
    calls++;
    assert.equal(
      url,
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilio!.account}/Messages.json`,
    );
    assert.equal(init?.redirect, "error");
    const form = init!.body as URLSearchParams;
    assert.equal(form.get("To"), `whatsapp:${input.destination}`);
    assert.equal(
      form.get("StatusCallback"),
      `${config.publicOrigin}/webhooks/twilio/status/${input.jobId}`,
    );
    return Response.json({
      sid: `SM${"2".repeat(32)}`,
      account_sid: config.twilio!.account,
      status: "queued",
    });
  });
  assert.equal(
    (await adapters.whatsapp.send(input, new AbortController().signal)).status,
    "accepted",
  );
  assert.equal(
    (
      await adapters.whatsapp.send(
        { ...input, windowUntil: null },
        new AbortController().signal,
      )
    ).category,
    "configuration",
  );
  assert.equal(calls, 1);
  const template = channelAdapters(
    {
      ...config,
      twilio: { ...config.twilio!, contentSid: `HX${"3".repeat(32)}` },
    },
    async (_url, init) => {
      const form = init!.body as URLSearchParams;
      assert.ok(form.get("ContentSid"));
      assert.equal(form.has("Body"), false);
      return Response.json({
        sid: `SM${"4".repeat(32)}`,
        account_sid: config.twilio!.account,
        status: "sent",
      });
    },
  );
  assert.equal(
    (
      await template.whatsapp.send(
        { ...input, windowUntil: null },
        new AbortController().signal,
      )
    ).status,
    "sent",
  );
});
test("email acceptance is not delivery and idempotency is transmitted", async () => {
  const id = randomUUID();
  const adapter = channelAdapters(config, async (_url, init) => {
    assert.equal(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
      input.key,
    );
    const body = JSON.parse(init!.body as string);
    assert.equal(body.tags[0].value, input.jobId);
    assert.ok(body.html);
    assert.ok(body.text);
    return Response.json({ id });
  }).email;
  assert.deepEqual(
    await adapter.send(
      { ...input, destination: "owner@example.invalid" },
      new AbortController().signal,
    ),
    { status: "accepted", messageId: id },
  );
});
test("provider errors are classified without secret or body leakage; ambiguity never becomes safe retry", async () => {
  for (const [code, status, category] of [
    [401, "failed", "configuration"],
    [422, "failed", "permanent"],
    [429, "failed", "rate_limit"],
    [503, "unknown", "unknown"],
  ] as const) {
    const adapter = channelAdapters(
      config,
      async () =>
        new Response("synthetic-private-token", {
          status: code,
          headers: { "retry-after": "60" },
        }),
    ).email;
    const result = await adapter.send(input, new AbortController().signal);
    assert.equal(result.status, status);
    assert.equal(result.category, category);
    assert.ok(!JSON.stringify(result).includes("synthetic-private"));
    if (code === 429) assert.equal(result.retryAfterMs, 60000);
  }
  const result = await deliveryCall(() => new Promise(() => undefined), 5);
  assert.deepEqual(result, { status: "unknown", category: "unknown" });
  assert.equal(
    (
      await deliveryCall(async () => {
        throw new Error("secret");
      }, 5)
    ).status,
    "unknown",
  );
  const missing = channelAdapters({ mode: "mock", sandbox: true }, async () => {
    throw new Error("must not call");
  });
  assert.equal(
    (await missing.email.send(input, new AbortController().signal)).category,
    "configuration",
  );
});
