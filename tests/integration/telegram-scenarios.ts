import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import {
  beginTelegramLink,
  receiveTelegramUpdate,
  removeTelegram,
} from "../../packages/domain/src/telegram.js";
import {
  notificationSettings,
  saveNotificationSettings,
  enqueueReminder,
  testNotification,
} from "../../packages/domain/src/notifications.js";
import {
  saveReminder,
  getReminder,
  cancelReminder,
} from "../../packages/domain/src/reminders.js";
import { TelegramPoller } from "../../services/worker/src/telegram-poller.js";
import {
  DeliveryEngine,
  outboxProvider,
} from "../../services/worker/src/delivery.js";
import {
  ReminderEngine,
  workerPolicy,
} from "../../services/worker/src/engine.js";
import { createLogger } from "../../packages/observability/src/index.js";
import type { DeliveryJob } from "../../packages/shared/src/notifications.js";
import type { DeliveryResult } from "../../packages/domain/src/notification-provider.js";

export async function telegramScenarios(t: TestContext, db: Kysely<Database>) {
  let now = new Date("2026-10-15T12:00:00Z"),
    owner = "",
    botId = "",
    chat = 1000,
    update = 0,
    calls = 0;
  let result: DeliveryResult = { status: "sent", messageId: "" };
  const logger = createLogger("silent");
  const engine = () =>
    new DeliveryEngine(
      db,
      {
        telegram: {
          async send() {
            calls++;
            return result;
          },
          async reconcile() {
            return { status: "unknown", category: "unknown" };
          },
        },
        email: {
          async send() {
            calls++;
            return { status: "delivered", messageId: randomUUID() };
          },
          async reconcile() {
            return { status: "unknown" };
          },
        },
      },
      logger,
      () => now,
      workerPolicy(),
      () => 0.5,
    );
  const jobs = async () =>
    (
      await sql<DeliveryJob>`select * from notification_jobs where user_id=${owner} order by created_at,id`.execute(
        db,
      )
    ).rows;
  const receive = async (text: string, id = ++update, type = "private") =>
    db.transaction().execute((trx) =>
      receiveTelegramUpdate(
        trx,
        botId,
        {
          update_id: id,
          message: {
            from: { id: chat, is_bot: false },
            chat: { id: chat, type },
            text,
          },
        },
        now,
      ),
    );
  const enable = async (fallback = false) => {
    const settings = await notificationSettings(db, owner);
    await saveNotificationSettings(
      db,
      owner,
      {
        telegram_enabled: true,
        email_enabled: fallback,
        fallback_enabled: fallback,
        fallback_after_seconds: 30,
        revision: settings.revision,
        consent: true,
      },
      randomUUID(),
    );
  };
  const link = async () => {
    const code = await beginTelegramLink(db, owner, botId, now);
    await receive(code.code);
    return code;
  };
  const reminder = async (recurrence = "none") =>
    saveReminder(
      db,
      owner,
      {
        title: "Telegram fixture",
        body: "private fixture body",
        local_due: "2026-10-15T12:00",
        timezone: "UTC",
        recurrence,
        confirmed: true,
      },
      randomUUID(),
      { key: randomUUID() },
    );
  async function scenario(name: string, fn: () => Promise<void>) {
    await t.test(`Telegram: ${name}`, async () => {
      owner = randomUUID();
      botId = String(++chat + 100000);
      update = 0;
      calls = 0;
      now = new Date("2026-10-15T12:00:00Z");
      result = { status: "sent", messageId: `${botId}:${chat}:1` };
      await sql`insert into users(id,google_subject,email,display_name,timezone,email_verified_at) values (${owner},${owner},'telegram@example.invalid','Telegram fixture','UTC',${now})`.execute(
        db,
      );
      try {
        await fn();
      } finally {
        await sql`update notification_jobs set next_attempt_at=null,fallback_deadline_at=null,lease_token=null,lease_until=null where user_id=${owner}`.execute(
          db,
        );
        await sql`update reminders set next_attempt_at=null,lease_token=null,lease_until=null where user_id=${owner}`.execute(
          db,
        );
      }
    });
  }
  await scenario(
    "private single-use expiring link, explicit consent, opt-out and replay",
    async () => {
      const code = await beginTelegramLink(db, owner, botId, now);
      await receive(code.code, 1, "group");
      assert.equal(
        (await notificationSettings(db, owner)).telegram_verified_at,
        null,
      );
      await receive(code.code, 2);
      assert.equal(
        (await notificationSettings(db, owner)).telegram_enabled,
        false,
      );
      await enable();
      await receive("/stop", 3);
      await receive(code.code, 2);
      assert.equal(
        (await notificationSettings(db, owner)).telegram_enabled,
        false,
      );
      const expired = await beginTelegramLink(db, owner, botId, now);
      now = new Date(now.getTime() + 600001);
      await receive(expired.code, 4);
      assert.equal(
        (await notificationSettings(db, owner)).telegram_verified_at,
        null,
      );
    },
  );
  await scenario(
    "one Telegram identity cannot attach to two owners",
    async () => {
      await link();
      const first = owner;
      owner = randomUUID();
      await sql`insert into users(id,google_subject,email,display_name) values (${owner},${owner},'other@example.invalid','Other')`.execute(
        db,
      );
      await link();
      assert.equal(
        (await notificationSettings(db, owner)).telegram_verified_at,
        null,
      );
      assert.equal(
        (await notificationSettings(db, first)).telegram_destination,
        String(chat),
      );
    },
  );
  await scenario(
    "poll cursor commits with linking, concurrent pollers and replay",
    async () => {
      const code = await beginTelegramLink(db, owner, botId, now);
      let fetches = 0;
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const fetcher: typeof fetch = async () => {
        fetches++;
        entered();
        await gate;
        return Response.json({
          ok: true,
          result: [
            {
              update_id: 10,
              message: {
                from: { id: chat, is_bot: false },
                chat: { id: chat, type: "private" },
                text: code.code,
              },
            },
          ],
        });
      };
      const bot = {
        botId,
        token: `${botId}:synthetic-only`,
        username: "test_bot",
      };
      const poller = new TelegramPoller(db, bot, fetcher, () => now);
      const firstPoll = poller.runOnce();
      await started;
      assert.equal(await poller.runOnce(), false);
      release();
      await firstPoll;
      assert.equal(fetches, 1);
      assert.equal(
        (await notificationSettings(db, owner)).telegram_destination,
        String(chat),
      );
      assert.equal(
        Number(
          (
            await sql<{
              next_offset: string;
            }>`select next_offset from telegram_poll_state where bot_id=${botId}`.execute(
              db,
            )
          ).rows[0]!.next_offset,
        ),
        11,
      );
      await removeTelegram(db, owner, randomUUID());
      await poller.runOnce();
      assert.equal(
        (await notificationSettings(db, owner)).telegram_verified_at,
        null,
      );
    },
  );
  await scenario(
    "failed polling keeps cursor and recovers expired lease",
    async () => {
      const bot = { botId, token: `${botId}:secret`, username: "test_bot" };
      const broken = new TelegramPoller(
        db,
        bot,
        async () => {
          throw Error(bot.token);
        },
        () => now,
      );
      await assert.rejects(broken.runOnce(), {
        message: "Telegram polling unavailable",
      });
      assert.equal(
        Number(
          (
            await sql<{
              next_offset: string;
            }>`select next_offset from telegram_poll_state where bot_id=${botId}`.execute(
              db,
            )
          ).rows[0]!.next_offset,
        ),
        0,
      );
      now = new Date(now.getTime() + 61000);
      assert.equal(
        await new TelegramPoller(
          db,
          bot,
          async () => Response.json({ ok: true, result: [] }),
          () => now,
        ).runOnce(),
        true,
      );
    },
  );
  await scenario(
    "concurrent delivery sends once, sent settles without claiming delivered, recurrence advances",
    async () => {
      await link();
      await enable(true);
      const row = await reminder("daily");
      const scheduler = new ReminderEngine(
        db,
        outboxProvider(db, () => now, "telegram"),
        logger,
        () => now,
        workerPolicy(),
      );
      await scheduler.runOnce();
      await Promise.all([engine().runOnce(), engine().runOnce()]);
      assert.equal(calls, 1);
      await scheduler.runOnce();
      const current = await getReminder(db, owner, row.id);
      assert.equal(current.occurrence, 2);
      assert.equal(current.status, "scheduled");
      const job = (await jobs())[0]!;
      assert.equal(job.status, "sent");
      assert.equal(job.delivered_at, null);
      assert.equal(job.next_attempt_at, null);
      assert.equal(job.attention, false);
      now = new Date(now.getTime() + 31000);
      await engine().fallbacks();
      assert.equal((await jobs()).length, 1);
    },
  );
  await scenario(
    "unknown send remains visible without blind retries, optional fallback once",
    async () => {
      await link();
      await enable(true);
      const row = await reminder();
      await enqueueReminder(
        db,
        row.id,
        owner,
        1,
        `${row.idempotency_key}:1`,
        now,
        "telegram",
      );
      result = { status: "unknown", category: "unknown" };
      await engine().runOnce();
      now = new Date(now.getTime() + 31000);
      await Promise.all([engine().fallbacks(), engine().fallbacks()]);
      assert.equal(
        (await jobs()).filter((j) => j.channel === "email").length,
        1,
      );
      for (let i = 0; i < 5; i++) {
        now = new Date(now.getTime() + 100000);
        await engine().runOnce();
      }
      const primary = (await jobs()).find((j) => j.channel === "telegram")!;
      assert.equal(primary.status, "unknown");
      assert.equal(primary.attention, true);
      assert.equal(primary.attempt_count, 1);
    },
  );
  await scenario(
    "dispatch crash is unknown, claim crash is reclaimed and unlink wins before dispatch",
    async () => {
      await link();
      await enable();
      await testNotification(db, owner, "telegram", randomUUID(), now);
      const e = engine(),
        claim = (await e.claim())!;
      now = new Date(now.getTime() + 61000);
      assert.equal(await e.prepare(claim), null);
      const recovered = (await e.claim())!;
      const work = (await e.prepare(recovered))!;
      assert.ok(work);
      now = new Date(now.getTime() + 61000);
      await engine().runOnce();
      assert.equal(calls, 0);
      assert.equal((await jobs())[0]!.status, "unknown");
      const second = await testNotification(
        db,
        owner,
        "telegram",
        randomUUID(),
        now,
      );
      await removeTelegram(db, owner, randomUUID());
      await engine().runOnce();
      assert.equal(
        (await jobs()).find((j) => j.id === second.id)!.status,
        "blocked",
      );
      assert.equal(calls, 0);
    },
  );
  await scenario(
    "email fallback is off by default and Telegram-only settles one-shot reminder",
    async () => {
      assert.equal(
        (await notificationSettings(db, owner)).fallback_enabled,
        false,
      );
      await link();
      await enable();
      const row = await reminder();
      const scheduler = new ReminderEngine(
        db,
        outboxProvider(db, () => now, "telegram"),
        logger,
        () => now,
        workerPolicy(),
      );
      await scheduler.runOnce();
      await engine().runOnce();
      await scheduler.runOnce();
      const saved = await getReminder(db, owner, row.id);
      assert.equal(saved.status, "sent");
      assert.equal(saved.reason, "telegram_sent");
      assert.equal(saved.next_attempt_at, null);
      assert.equal(saved.attention, false);
      await assert.rejects(
        cancelReminder(db, owner, row.id, saved.version, randomUUID()),
        /already sent to Telegram/,
      );
      assert.equal((await getReminder(db, owner, row.id)).status, "sent");
    },
  );
  await scenario(
    "stale polling result cannot link or advance a newer lease",
    async () => {
      const code = await beginTelegramLink(db, owner, botId, now);
      const poller = new TelegramPoller(
        db,
        { botId, token: `${botId}:synthetic`, username: "test_bot" },
        async () => {
          await sql`update telegram_poll_state set lease_token=${randomUUID()} where bot_id=${botId}`.execute(
            db,
          );
          return Response.json({
            ok: true,
            result: [
              {
                update_id: 99,
                message: {
                  from: { id: chat, is_bot: false },
                  chat: { id: chat, type: "private" },
                  text: code.code,
                },
              },
            ],
          });
        },
        () => now,
      );
      assert.equal(await poller.runOnce(), false);
      assert.equal(
        (await notificationSettings(db, owner)).telegram_verified_at,
        null,
      );
      assert.equal(
        Number(
          (
            await sql<{
              next_offset: string;
            }>`select next_offset from telegram_poll_state where bot_id=${botId}`.execute(
              db,
            )
          ).rows[0]!.next_offset,
        ),
        0,
      );
    },
  );
}
