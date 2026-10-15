import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import request from "supertest";
import twilio from "twilio";
import { Webhook } from "svix";
import type { Database } from "../../packages/database/src/index.js";
import { createLogger } from "../../packages/observability/src/index.js";
import {
  notificationSettings,
  saveNotificationSettings,
  enqueueReminder,
  beginPhoneLink,
  receivePhoneMessage,
  deliveryWebhook,
  testNotification,
} from "../../packages/domain/src/notifications.js";
import {
  saveReminder,
  getReminder,
  cancelReminder,
  savePreferences,
} from "../../packages/domain/src/reminders.js";
import type { DeliveryJob } from "../../packages/shared/src/notifications.js";
import type {
  DeliveryResult,
  ChannelAdapter,
  MessagingConfig,
} from "../../packages/domain/src/notification-provider.js";
import { channelAdapters } from "../../packages/domain/src/notification-provider.js";
import { receiveTelegramUpdate } from "../../packages/domain/src/telegram.js";
import {
  DeliveryEngine,
  outboxProvider,
} from "../../services/worker/src/delivery.js";
import {
  ReminderEngine,
  workerPolicy,
} from "../../services/worker/src/engine.js";
import { createAuth } from "../../services/api/src/auth.js";
import { createApp } from "../../services/api/src/app.js";

export async function notificationScenarios(
  t: TestContext,
  db: Kysely<Database>,
  connection: string,
) {
  let now = new Date("2026-10-12T12:00:00Z"),
    owner = "",
    calls: string[] = [],
    logs = "";
  const logger = createLogger("info", {
    write: (s: string) => {
      logs += s;
    },
  });
  let whatsapp: DeliveryResult = {
      status: "accepted",
      messageId: `SM${"a".repeat(32)}`,
    },
    email: DeliveryResult = { status: "delivered", messageId: randomUUID() };
  let reconcile: DeliveryResult = { status: "unknown", category: "unknown" };
  const adapter = (channel: "whatsapp" | "email"): ChannelAdapter => ({
    async send() {
      calls.push(channel);
      return channel === "whatsapp" ? whatsapp : email;
    },
    async reconcile() {
      calls.push(`check:${channel}`);
      return reconcile;
    },
  });
  const engine = () =>
    new DeliveryEngine(
      db,
      { whatsapp: adapter("whatsapp"), email: adapter("email") },
      logger,
      () => now,
      workerPolicy(),
      () => 0.5,
    );
  const settings = () => notificationSettings(db, owner);
  const job = async (id: string) =>
    (
      await sql<DeliveryJob>`select * from notification_jobs where id=${id}`.execute(
        db,
      )
    ).rows[0]!;
  const jobs = async () =>
    (
      await sql<DeliveryJob>`select * from notification_jobs where user_id=${owner} order by created_at,id`.execute(
        db,
      )
    ).rows;
  const create = async () => {
    const r = await saveReminder(
      db,
      owner,
      {
        title: "Private synthetic reminder",
        body: "private-notification-body",
        local_due: "2026-10-12T12:00",
        timezone: "UTC",
        confirmed: true,
      },
      randomUUID(),
      { key: randomUUID() },
    );
    await sql`update reminders set channel_policy='whatsapp_email',status='sent',next_attempt_at=null where id=${r.id}`.execute(
      db,
    );
    await enqueueReminder(
      db,
      r.id,
      owner,
      r.occurrence,
      `${r.idempotency_key}:${r.occurrence}`,
      now,
    );
    return r;
  };
  const fallback = async () =>
    (await jobs()).find((j) => j.channel === "email")!;
  async function scenario(name: string, fn: () => Promise<void>) {
    await t.test(`M3: ${name}`, async () => {
      now = new Date("2026-10-12T12:00:00Z");
      owner = randomUUID();
      calls = [];
      logs = "";
      whatsapp = {
        status: "accepted",
        messageId: `SM${randomBytes(16).toString("hex")}`,
      };
      email = { status: "delivered", messageId: randomUUID() };
      reconcile = { status: "unknown", category: "unknown" };
      await sql`insert into users(id,google_subject,email,display_name,timezone,email_verified_at) values (${owner},${owner},'notification@example.invalid','Notification fixture','UTC',${now})`.execute(
        db,
      );
      const s = await settings();
      await sql`update notification_preferences set fallback_enabled=true,whatsapp_destination=${`+15${Math.floor(
        Math.random() * 1e9,
      )
        .toString()
        .padStart(
          9,
          "0",
        )}`},whatsapp_verified_at=${now},whatsapp_enabled=true,email_enabled=true,email_destination='notification@example.invalid' where user_id=${owner}`.execute(
        db,
      );
      assert.ok(s.revision);
      try {
        await fn();
        assert.ok(!logs.includes("private-notification-body"));
      } finally {
        await sql`update reminders set next_attempt_at=null,lease_token=null,lease_until=null where user_id=${owner}`.execute(
          db,
        );
        await sql`update notification_jobs set next_attempt_at=null,fallback_deadline_at=null,lease_token=null,lease_until=null where user_id=${owner}`.execute(
          db,
        );
      }
    });
  }
  await scenario(
    "concurrent enqueue and claims produce one logical dispatch",
    async () => {
      const r = await create();
      await Promise.all([
        enqueueReminder(
          db,
          r.id,
          owner,
          r.occurrence,
          `${r.idempotency_key}:${r.occurrence}`,
          now,
        ),
        enqueueReminder(
          db,
          r.id,
          owner,
          r.occurrence,
          `${r.idempotency_key}:${r.occurrence}`,
          now,
        ),
      ]);
      assert.equal((await jobs()).length, 1);
      await Promise.all([engine().runOnce(), engine().runOnce()]);
      assert.deepEqual(calls, ["whatsapp"]);
      assert.equal((await jobs())[0]!.status, "accepted");
    },
  );
  await scenario(
    "confirmed delivery suppresses fallback and reordered callbacks cannot downgrade",
    async () => {
      await create();
      await engine().runOnce();
      const primary = (await jobs())[0]!;
      await deliveryWebhook(
        db,
        "twilio",
        `${primary.id}:delivered`,
        primary.provider_message_id!,
        { status: "delivered" },
        { jobId: primary.id },
        now,
      );
      await deliveryWebhook(
        db,
        "twilio",
        `${primary.id}:delivered`,
        primary.provider_message_id!,
        { status: "delivered" },
        { jobId: primary.id },
        now,
      );
      await deliveryWebhook(
        db,
        "twilio",
        `${primary.id}:sent`,
        primary.provider_message_id!,
        { status: "sent" },
        { jobId: primary.id },
        now,
      );
      now = new Date(now.getTime() + 301000);
      await engine().runOnce();
      assert.equal((await job(primary.id)).status, "delivered");
      assert.equal((await jobs()).length, 1);
      assert.equal(calls.filter((x) => x === "email").length, 0);
    },
  );
  await scenario(
    "unknown deadline triggers one fallback and preserves late WhatsApp delivery",
    async () => {
      whatsapp = { status: "unknown", category: "unknown" };
      await create();
      await engine().runOnce();
      const primary = (await jobs())[0]!;
      now = new Date(now.getTime() + 299000);
      await engine().runOnce();
      assert.equal((await jobs()).length, 1);
      now = new Date(now.getTime() + 2000);
      await engine().runOnce();
      assert.ok(await fallback());
      await Promise.all([engine().runOnce(), engine().runOnce()]);
      assert.equal(calls.filter((x) => x === "email").length, 1);
      assert.equal((await fallback()).status, "delivered");
      await deliveryWebhook(
        db,
        "twilio",
        `${primary.id}:late`,
        `SM${randomBytes(16).toString("hex")}`,
        { status: "delivered" },
        { jobId: primary.id },
        now,
      );
      assert.equal((await job(primary.id)).status, "delivered");
      assert.equal((await fallback()).status, "delivered");
      await engine().runOnce();
      assert.equal(calls.filter((x) => x === "whatsapp").length, 1);
    },
  );
  await scenario(
    "permanent primary failure falls back immediately and missing email stays visible",
    async () => {
      whatsapp = { status: "failed", category: "permanent" };
      await sql`update notification_preferences set email_enabled=false,email_destination=null where user_id=${owner}`.execute(
        db,
      );
      await create();
      await engine().runOnce();
      const secondary = await fallback();
      assert.equal(secondary.status, "blocked");
      assert.equal(secondary.attention, true);
      assert.deepEqual(calls, ["whatsapp"]);
    },
  );
  await scenario(
    "explicit rate rejection retries boundedly; acceptance never blindly retries",
    async () => {
      whatsapp = {
        status: "failed",
        category: "rate_limit",
        retryAfterMs: 60000,
      };
      await create();
      await engine().runOnce();
      const primary = (await jobs())[0]!;
      assert.equal(primary.status, "retry_scheduled");
      now = new Date(now.getTime() + 59000);
      await engine().runOnce();
      assert.equal(calls.length, 1);
      now = new Date(now.getTime() + 1000);
      whatsapp = {
        status: "accepted",
        messageId: `SM${randomBytes(16).toString("hex")}`,
      };
      await engine().runOnce();
      assert.equal(calls.filter((x) => x === "whatsapp").length, 2);
      now = new Date(now.getTime() + 30000);
      await engine().runOnce();
      assert.equal(calls.filter((x) => x === "whatsapp").length, 2);
      assert.ok(calls.includes("check:whatsapp"));
    },
  );
  await scenario(
    "crash after claim is reclaimed; crash after dispatch is unknown without resend",
    async () => {
      await create();
      const first = engine();
      const claimed = await first.claim();
      assert.ok(claimed);
      assert.equal(await engine().claim(), null);
      now = new Date(now.getTime() + 61000);
      const second = engine();
      const reclaimed = await second.claim();
      assert.ok(reclaimed);
      const work = await second.prepare(reclaimed);
      assert.ok(work);
      assert.equal(work.reconcile, false);
      // Represents a process dying after the persisted dispatch boundary, possibly after acceptance.
      now = new Date(now.getTime() + 61000);
      await engine().runOnce();
      assert.equal((await job(reclaimed.id)).status, "unknown");
      assert.deepEqual(calls, []);
      assert.equal(await first.prepare(claimed), null);
    },
  );
  await scenario(
    "callback before send result persistence survives and binds exact provider ID",
    async () => {
      await create();
      const e = engine();
      const claim = await e.claim();
      const work = await e.prepare(claim!);
      assert.ok(work);
      const id = `SM${randomBytes(16).toString("hex")}`;
      await deliveryWebhook(
        db,
        "twilio",
        `${id}:delivered`,
        id,
        { status: "delivered" },
        { jobId: work.job.id },
        now,
      );
      await e.complete(work, { status: "accepted", messageId: id });
      assert.equal((await job(work.job.id)).status, "delivered");
      assert.equal(
        await deliveryWebhook(
          db,
          "twilio",
          "mismatch",
          `SM${randomBytes(16).toString("hex")}`,
          { status: "failed" },
          { jobId: work.job.id },
          now,
        ),
        false,
      );
    },
  );
  await scenario(
    "queued cancellation and rescheduling prevent old transport calls",
    async () => {
      const r = await create();
      const e = engine();
      const claim = await e.claim();
      const current = await getReminder(db, owner, r.id);
      await cancelReminder(db, owner, r.id, current.version, randomUUID());
      assert.equal(await e.prepare(claim!), null);
      assert.equal((await job(claim!.id)).status, "suppressed");
      assert.equal(calls.length, 0);
      const next = await create();
      const saved = await getReminder(db, owner, next.id);
      await saveReminder(
        db,
        owner,
        {
          title: "Rescheduled",
          local_due: "2026-10-13T12:00",
          timezone: "UTC",
          confirmed: true,
        },
        randomUUID(),
        { id: next.id, version: saved.version },
      );
      await engine().runOnce();
      assert.equal(calls.length, 0);
    },
  );
  await scenario(
    "quiet hours defer transport and consent change blocks pending delivery",
    async () => {
      await savePreferences(
        db,
        owner,
        { quiet_start: "11:00", quiet_end: "13:00", focus_blocks: [] },
        0,
        randomUUID(),
      );
      await create();
      await engine().runOnce();
      assert.equal(calls.length, 0);
      assert.equal(
        new Date((await jobs())[0]!.next_attempt_at!).toISOString(),
        "2026-10-12T13:00:00.000Z",
      );
      const s = await settings();
      await saveNotificationSettings(
        db,
        owner,
        {
          whatsapp_enabled: false,
          email_enabled: true,
          fallback_enabled: true,
          fallback_after_seconds: 300,
          revision: s.revision,
          consent: true,
        },
        randomUUID(),
      );
      now = new Date("2026-10-12T13:00:01Z");
      await engine().runOnce();
      assert.equal((await jobs())[0]!.status, "blocked");
      assert.equal(calls.length, 0);
    },
  );
  await scenario(
    "email outage is unknown and retries stop with attention",
    async () => {
      whatsapp = { status: "failed", category: "configuration" };
      email = { status: "unknown", category: "unknown" };
      await create();
      await engine().runOnce();
      await engine().runOnce();
      for (let i = 0; i < 3; i++) {
        now = new Date(now.getTime() + 200000);
        await engine().runOnce();
      }
      const secondary = await fallback();
      assert.equal(secondary.status, "unknown");
      assert.equal(secondary.attention, true);
      assert.equal(secondary.next_attempt_at, null);
      assert.equal(calls.filter((x) => x === "email").length, 1);
    },
  );
  await scenario(
    "missing provider configuration fails safely without network",
    async () => {
      await create();
      const e = new DeliveryEngine(
        db,
        channelAdapters({ mode: "live", sandbox: true }, async () => {
          throw new Error("network must not run");
        }),
        logger,
        () => now,
      );
      await e.runOnce();
      await e.runOnce();
      assert.ok((await jobs()).every((j) => j.status === "failed"));
    },
  );
  await scenario(
    "phone proof is single-use, replay cannot reopen STOP, test keys are durable",
    async () => {
      const phone = "+15005550199";
      const code = await beginPhoneLink(db, owner, phone, now);
      const sid = `SM${randomBytes(16).toString("hex")}`;
      await receivePhoneMessage(db, sid, phone, code.code, now);
      assert.equal((await settings()).whatsapp_destination, phone);
      assert.equal((await settings()).whatsapp_enabled, false);
      await receivePhoneMessage(
        db,
        `SM${randomBytes(16).toString("hex")}`,
        phone,
        "STOP",
        now,
      );
      await receivePhoneMessage(db, sid, phone, code.code, now);
      assert.equal((await settings()).whatsapp_verified_at, null);
      const key = randomUUID();
      const a = await testNotification(db, owner, "email", key, now);
      const b = await testNotification(db, owner, "email", key, now);
      assert.equal(a.id, b.id);
      await assert.rejects(testNotification(db, owner, "whatsapp", key, now));
    },
  );
  await scenario(
    "M2 scheduler bridge recovers before outbox insertion and advances recurrence once",
    async () => {
      const r = await saveReminder(
        db,
        owner,
        {
          title: "Recurring",
          local_due: "2026-10-12T12:00",
          timezone: "UTC",
          recurrence: "daily",
          confirmed: true,
        },
        randomUUID(),
        { key: randomUUID() },
      );
      const scheduler = new ReminderEngine(
        db,
        outboxProvider(db, () => now),
        logger,
        () => now,
      );
      const claim = await scheduler.claim();
      assert.equal(claim?.id, r.id);
      const work = await scheduler.prepare(claim!);
      assert.ok(work);
      now = new Date(now.getTime() + 61000);
      await scheduler.runOnce();
      assert.equal((await jobs()).length, 1);
      whatsapp = {
        status: "delivered",
        messageId: `SM${randomBytes(16).toString("hex")}`,
      };
      await engine().runOnce();
      await scheduler.runOnce();
      const final = await getReminder(db, owner, r.id);
      assert.equal(final.occurrence, 2);
      assert.equal(final.status, "scheduled");
      assert.equal(calls.filter((x) => x === "whatsapp").length, 1);
    },
  );
  await scenario(
    "hard process exits preserve dispatch uncertainty and completed results",
    async () => {
      for (const phase of ["claim", "dispatch", "receipt", "complete"]) {
        now = new Date("2026-10-12T12:00:00Z");
        await create();
        const primary = (await jobs()).find((j) => j.next_attempt_at)!;
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "tests/integration/delivery-crash-fixture.ts",
            phase,
          ],
          {
            env: {
              ...process.env,
              TEST_DATABASE_URL: connection,
              AI_CREDENTIALS_ENCRYPTION_KEY: "invalid-model-config",
            },
            stdio: "ignore",
          },
        );
        const [code] = await once(child, "exit");
        assert.equal(code, 17);
        now = new Date("2026-10-12T12:01:01Z");
        await engine().runOnce();
        const saved = await job(primary.id);
        assert.equal(
          saved.status,
          phase === "complete"
            ? "delivered"
            : phase === "claim"
              ? "accepted"
              : "unknown",
        );
        const receipts = (
          await sql<{
            n: number;
          }>`select count(*)::int n from mock_notification_receipts where idempotency_key=${`${primary.logical_key}:whatsapp`}`.execute(
            db,
          )
        ).rows[0]!.n;
        assert.equal(
          receipts,
          phase === "receipt" || phase === "complete" ? 1 : 0,
        );
        if (phase === "receipt") assert.equal(saved.attempt_count, 1);
        await sql`update notification_jobs set next_attempt_at=null,fallback_deadline_at=null,lease_token=null,lease_until=null where user_id=${owner}`.execute(
          db,
        );
      }
    },
  );
  await scenario(
    "delivery confirmation before queued fallback dispatch suppresses email",
    async () => {
      whatsapp = { status: "unknown", category: "unknown" };
      await create();
      await engine().runOnce();
      const primary = (await jobs())[0]!;
      now = new Date(now.getTime() + 301000);
      await engine().fallbacks();
      const secondary = await fallback();
      assert.equal(secondary.status, "queued");
      await deliveryWebhook(
        db,
        "twilio",
        `${primary.id}:confirmed`,
        `SM${randomBytes(16).toString("hex")}`,
        { status: "delivered" },
        { jobId: primary.id },
        now,
      );
      await engine().runOnce();
      assert.equal((await job(secondary.id)).status, "suppressed");
      assert.equal(calls.filter((c) => c === "email").length, 0);
    },
  );
  await scenario(
    "deadline status lookup can confirm delivery before activating fallback",
    async () => {
      await create();
      await engine().runOnce();
      const primary = (await jobs())[0]!;
      reconcile = {
        status: "delivered",
        messageId: primary.provider_message_id!,
      };
      now = new Date(now.getTime() + 301000);
      await engine().fallbacks();
      assert.equal((await job(primary.id)).status, "delivered");
      assert.equal((await jobs()).length, 1);
    },
  );
  await scenario("signed webhooks and two-session API isolation", async () => {
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
        key: "synthetic-private-key",
        from: "axis@example.invalid",
        webhookSecret: `whsec_${randomBytes(32).toString("base64")}`,
      },
    };
    const auth = createAuth(
      db,
      connection,
      {
        origin: "http://localhost:3000",
        secret: randomBytes(48).toString("hex"),
        clientId: "synthetic",
        clientSecret: "synthetic",
      },
      {
        async begin() {
          const state = randomUUID();
          return {
            url: `http://localhost:3000/synthetic?state=${state}`,
            challenge: { state, nonce: randomUUID(), verifier: randomUUID() },
          };
        },
        async verify(url) {
          return {
            subject: `m3-${owner}-${url.searchParams.get("code")}`,
            email: `${url.searchParams.get("code")}@example.invalid`,
            name: "Fixture",
            verified: true,
          };
        },
      },
    );
    try {
      const app = createApp({
        db,
        auth,
        logger,
        checkReady: async () => undefined,
        messaging: config,
      });
      const a = request.agent(app),
        b = request.agent(app);
      async function login(client: typeof a, code: string) {
        const start = await client.get("/auth/google");
        const state = new URL(start.headers.location!).searchParams.get(
          "state",
        );
        await client
          .get(`/auth/google/callback?state=${state}&code=${code}`)
          .expect(302);
        return (await client.get("/api/v1/me").expect(200)).body;
      }
      const aa = await login(a, "a"),
        bb = await login(b, "b");
      const ha = {
          Origin: "http://localhost:3000",
          "X-CSRF-Token": aa.csrfToken,
        },
        hb = { Origin: "http://localhost:3000", "X-CSRF-Token": bb.csrfToken };
      const s = (await a.get("/api/v1/notification-settings")).body.settings;
      await a
        .put("/api/v1/notification-settings")
        .set(ha)
        .send({
          whatsapp_enabled: false,
          email_enabled: true,
          fallback_enabled: true,
          fallback_after_seconds: 300,
          revision: s.revision,
          consent: true,
        })
        .expect(200);
      await a
        .post("/api/v1/notifications/test")
        .send({ channel: "email", consent: true })
        .expect(403);
      await a
        .post("/api/v1/notifications/test")
        .set(ha)
        .set("Idempotency-Key", randomUUID())
        .send({
          channel: "email",
          consent: true,
          to: "attacker@example.invalid",
        })
        .expect(400);
      const savedEmailConfig = config.email;
      config.email = undefined;
      await a
        .post("/api/v1/notifications/test")
        .set(ha)
        .set("Idempotency-Key", randomUUID())
        .send({ channel: "email", consent: true })
        .expect(422);
      assert.equal((await a.get("/api/v1/notifications")).body.items.length, 0);
      config.email = savedEmailConfig;
      const queued = await a
        .post("/api/v1/notifications/test")
        .set(ha)
        .set("Idempotency-Key", randomUUID())
        .send({ channel: "email", consent: true })
        .expect(202);
      await sql`update notification_jobs set next_attempt_at=${new Date(now.getTime() - 1000)} where id=${queued.body.id}`.execute(
        db,
      );
      await b.get(`/api/v1/notifications/${queued.body.id}`).expect(404);
      await b
        .post(`/api/v1/notifications/${queued.body.id}/reconcile`)
        .set(hb)
        .send({})
        .expect(409);
      assert.equal((await b.get("/api/v1/notifications")).body.items.length, 0);
      // Fresh API instance and persistent session still see the queued job.
      await a.get(`/api/v1/notifications/${queued.body.id}`).expect(200);
      await create();
      const e = engine();
      const claim = await e.claim();
      const work = await e.prepare(claim!);
      assert.ok(work);
      // The queued email test may be selected first; explicitly prepare WhatsApp below.
      if (work.job.channel === "email") {
        await e.complete(work, { status: "accepted", messageId: randomUUID() });
      }
      const primary = (await jobs()).find((j) => j.channel === "whatsapp")!;
      if (primary.attempt_count === 0) {
        const c = await e.claim();
        assert.equal(c?.id, primary.id);
        await e.prepare(c!);
      }
      const path = `/webhooks/twilio/status/${primary.id}`,
        id = `SM${randomBytes(16).toString("hex")}`;
      const params = {
        AccountSid: config.twilio!.account,
        MessageSid: id,
        MessageStatus: "delivered",
        From: config.twilio!.from,
        To: `whatsapp:${primary.destination}`,
      };
      await request(app).post(path).type("form").send(params).expect(403);
      const wrongAccount = { ...params, AccountSid: `AC${"2".repeat(32)}` };
      await request(app)
        .post(path)
        .set(
          "X-Twilio-Signature",
          twilio.getExpectedTwilioSignature(
            config.twilio!.token,
            `${config.publicOrigin}${path}`,
            wrongAccount,
          ),
        )
        .type("form")
        .send(wrongAccount)
        .expect(403);
      const signature = twilio.getExpectedTwilioSignature(
        config.twilio!.token,
        `${config.publicOrigin}${path}`,
        params,
      );
      await request(app)
        .post(path)
        .set("X-Twilio-Signature", signature)
        .set("Host", "attacker.invalid")
        .type("form")
        .send(params)
        .expect(204);
      await request(app)
        .post(path)
        .set("X-Twilio-Signature", signature)
        .type("form")
        .send(params)
        .expect(204);
      assert.equal((await job(primary.id)).status, "delivered");
      const unknownPath = `/webhooks/twilio/status/${randomUUID()}`;
      await request(app)
        .post(unknownPath)
        .set(
          "X-Twilio-Signature",
          twilio.getExpectedTwilioSignature(
            config.twilio!.token,
            `${config.publicOrigin}${unknownPath}`,
            params,
          ),
        )
        .type("form")
        .send(params)
        .expect(204);
      const emailJob = await job(queued.body.id);
      const eventId = `msg_${randomUUID()}`;
      const payload = JSON.stringify({
        type: "email.delivered",
        data: {
          email_id: emailJob.provider_message_id,
          to: ["a@example.invalid"],
          tags: { axis_job: emailJob.id },
        },
      });
      const timestamp = new Date();
      const svix = new Webhook(config.email!.webhookSecret);
      await request(app)
        .post("/webhooks/resend")
        .set("Content-Type", "application/json")
        .send(payload)
        .expect(403);
      await request(app)
        .post("/webhooks/resend")
        .set("Content-Type", "application/json")
        .set("svix-id", eventId)
        .set("svix-timestamp", String(Math.floor(timestamp.getTime() / 1000)))
        .set("svix-signature", svix.sign(eventId, timestamp, payload))
        .send(payload)
        .expect(204);
      assert.equal((await job(emailJob.id)).status, "delivered");
      await request(app)
        .post("/webhooks/resend")
        .set("Content-Type", "application/json")
        .set("svix-id", eventId)
        .set("svix-timestamp", String(Math.floor(timestamp.getTime() / 1000)))
        .set("svix-signature", svix.sign(eventId, timestamp, payload))
        .send(payload)
        .expect(204);
      const expired = new Date(timestamp.getTime() - 600000);
      await request(app)
        .post("/webhooks/resend")
        .set("Content-Type", "application/json")
        .set("svix-id", eventId)
        .set("svix-timestamp", String(Math.floor(expired.getTime() / 1000)))
        .set("svix-signature", svix.sign(eventId, expired, payload))
        .send(payload)
        .expect(403);
      config.telegram = {
        botId: "123456789",
        token: "123456789:synthetic-secret-token",
        username: "axis_test_bot",
      };
      await a
        .post("/api/v1/notification-settings/telegram/link")
        .send({})
        .expect(403);
      await a
        .post("/api/v1/notification-settings/telegram/link")
        .set(ha)
        .send({ user_id: bb.user.id })
        .expect(400);
      const linked = await a
        .post("/api/v1/notification-settings/telegram/link")
        .set(ha)
        .send({})
        .expect(200);
      await db.transaction().execute((trx) =>
        receiveTelegramUpdate(
          trx,
          config.telegram!.botId,
          {
            update_id: 1,
            message: {
              from: { id: 999001, is_bot: false },
              chat: { id: 999001, type: "private" },
              text: linked.body.code,
            },
          },
          new Date(),
        ),
      );
      const as = (await a.get("/api/v1/notification-settings")).body;
      assert.equal(as.settings.telegram_destination, "999001");
      assert.ok(!JSON.stringify(as).includes(config.telegram.token));
      assert.equal(
        (await b.get("/api/v1/notification-settings")).body.settings
          .telegram_destination,
        null,
      );
      await b
        .delete("/api/v1/notification-settings/telegram")
        .set(hb)
        .expect(204);
      assert.equal(
        (await a.get("/api/v1/notification-settings")).body.settings
          .telegram_destination,
        "999001",
      );
      await a
        .put("/api/v1/notification-settings")
        .set(ha)
        .send({
          telegram_enabled: true,
          email_enabled: false,
          fallback_enabled: false,
          fallback_after_seconds: 300,
          revision: as.settings.revision,
          consent: true,
        })
        .expect(200);
      const tg = await a
        .post("/api/v1/notifications/test")
        .set(ha)
        .set("Idempotency-Key", randomUUID())
        .send({ channel: "telegram", consent: true })
        .expect(202);
      await b.get(`/api/v1/notifications/${tg.body.id}`).expect(404);
      await a
        .post(`/api/v1/notifications/${tg.body.id}/reconcile`)
        .set(ha)
        .send({})
        .expect(409);
      await a
        .post("/api/v1/notification-settings/whatsapp/link")
        .set(ha)
        .send({ phone: "+15005550006" })
        .expect(410);
      await sql`update notification_jobs set next_attempt_at=null,fallback_deadline_at=null,lease_token=null,lease_until=null where user_id in (${aa.user.id},${bb.user.id})`.execute(
        db,
      );
    } finally {
      await auth.close();
    }
  });
}
