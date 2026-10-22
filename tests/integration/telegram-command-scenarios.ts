import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import request from "supertest";
import type { Database } from "../../packages/database/src/index.js";
import { notificationSettings } from "../../packages/domain/src/notifications.js";
import {
  receiveTelegramUpdate,
  removeTelegram,
} from "../../packages/domain/src/telegram.js";
import { TelegramCommandWorker } from "../../services/worker/src/telegram-commands.js";
import { createApp } from "../../services/api/src/app.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { getRecord, saveRecord } from "../../packages/domain/src/records.js";
import { getReminder } from "../../packages/domain/src/reminders.js";
import type { ChatAction } from "../../packages/shared/src/chat-actions.js";

export async function telegramCommandScenarios(
  t: TestContext,
  db: Kysely<Database>,
) {
  let serial = 900000;
  async function fixture() {
    const owner = randomUUID(),
      chat = ++serial,
      botId = String(++serial),
      replies: string[] = [];
    await sql`insert into users(id,google_subject,email,display_name,timezone) values (${owner},${owner},${`${owner}@example.invalid`},'Telegram fixture','Asia/Kolkata')`.execute(
      db,
    );
    await notificationSettings(db, owner);
    await sql`update notification_preferences set telegram_bot_id=${botId},telegram_destination=${String(chat)},telegram_verified_at=now() where user_id=${owner}`.execute(
      db,
    );
    let update = 0,
      calls = 0,
      timeout = false;
    const bot = {
      botId,
      token: `${botId}:test-only-not-a-real-credential`,
      username: "axis_test_bot",
    };
    const worker = new TelegramCommandWorker(
      db,
      bot,
      {
        async agentCompletion() {
          calls++;
          return {
            content: JSON.stringify({
              reply: "Review",
              proposal: {
                kind: "task",
                title: "AI draft",
                description: "",
                local_due: null,
              },
            }),
            usage: null,
          };
        },
      },
      async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { text: string };
        replies.push(body.text);
        if (timeout) throw new Error("mock timeout");
        return new Response(
          JSON.stringify({
            ok: true,
            result: { message_id: replies.length, chat: { id: chat } },
          }),
        );
      },
    );
    const envelope = (text: string, id = ++update) => ({
      update_id: id,
      message: {
        from: { id: chat, is_bot: false },
        chat: { id: chat, type: "private" },
        text,
      },
    });
    const receive = (text: string, id?: number) =>
      db
        .transaction()
        .execute((trx) =>
          receiveTelegramUpdate(
            trx,
            botId,
            envelope(text, id),
            new Date(),
            true,
          ),
        );
    const send = async (text: string) => {
      await receive(text);
      await worker.runOnce();
    };
    const latest = async () =>
      (
        await sql<ChatAction>`select * from ai_action_proposals where user_id=${owner} order by created_at desc,id desc limit 1`.execute(
          db,
        )
      ).rows[0]!;
    return {
      owner,
      chat,
      botId,
      bot,
      worker,
      replies,
      receive,
      send,
      envelope,
      latest,
      calls: () => calls,
      timeout: () => {
        timeout = true;
      },
    };
  }
  await t.test(
    "Telegram durable duplicates and concurrent workers create once only after confirmation",
    async () => {
      const f = await fixture();
      await Promise.all([
        f.receive("/task Persist this", 50),
        f.receive("/task Persist this", 50),
      ]);
      await Promise.all([f.worker.runOnce(), f.worker.runOnce()]);
      assert.equal(
        (await sql`select id from tasks where user_id=${f.owner}`.execute(db))
          .rows.length,
        0,
      );
      const p = await f.latest();
      assert.equal(p.payload.title, "Persist this");
      // A new worker instance reads the persisted inbox and approval association.
      await f.receive(`/confirm ${p.id}`, 51);
      await f.receive(`/confirm ${p.id}`, 52);
      await Promise.all([f.worker.runOnce(), f.worker.runOnce()]);
      assert.equal(
        (await sql`select id from tasks where user_id=${f.owner}`.execute(db))
          .rows.length,
        1,
      );
      assert.equal(f.calls(), 0);
    },
  );
  await t.test(
    "Telegram natural language drafts use BYOK adapter but cannot execute",
    async () => {
      const f = await fixture();
      await f.send("Create a task to read my report");
      assert.equal(f.calls(), 1);
      assert.equal((await f.latest()).status, "pending");
      assert.equal(
        (await sql`select id from tasks where user_id=${f.owner}`.execute(db))
          .rows.length,
        0,
      );
    },
  );
  await t.test(
    "Telegram expired/rejected approvals and permanent deletion never execute",
    async () => {
      const f = await fixture();
      await f.send("/task Expiry fixture");
      const original = await f.latest(),
        expired = randomUUID();
      await sql`insert into ai_action_proposals(id,user_id,payload,payload_hash,expires_at) values (${expired},${f.owner},${JSON.stringify(original.payload)}::jsonb,${original.payload_hash},now()-interval '1 second')`.execute(
        db,
      );
      await sql`insert into telegram_command_proposals(proposal_id,user_id,bot_id,destination,link_revision) select ${expired},user_id,bot_id,destination,link_revision from telegram_command_proposals where proposal_id=${original.id}`.execute(
        db,
      );
      await f.send(`/confirm ${expired}`);
      assert.equal(
        (
          await sql<{
            status: string;
          }>`select status from ai_action_proposals where id=${expired}`.execute(
            db,
          )
        ).rows[0]!.status,
        "expired",
      );
      await f.send(`/reject ${original.id}`);
      await f.send(`/confirm ${original.id}`);
      await f.send("/delete everything");
      assert.equal(
        (await sql`select id from tasks where user_id=${f.owner}`.execute(db))
          .rows.length,
        0,
      );
    },
  );
  await t.test(
    "Telegram owner isolation, group and forwarded messages fail closed",
    async () => {
      const f = await fixture(),
        other = await fixture();
      await f.send("/task Private title");
      const p = await f.latest();
      await other.send(`/confirm ${p.id}`);
      assert.equal((await f.latest()).status, "pending");
      const group = f.envelope("/task Group");
      group.message.chat.type = "group";
      await db
        .transaction()
        .execute((trx) =>
          receiveTelegramUpdate(trx, f.botId, group, new Date(), true),
        );
      const forwarded = {
        ...f.envelope("/task Forwarded"),
        message: {
          ...f.envelope("/task Forwarded").message,
          forward_origin: { type: "user" },
        },
      };
      await db
        .transaction()
        .execute((trx) =>
          receiveTelegramUpdate(trx, f.botId, forwarded, new Date(), true),
        );
      assert.equal(
        (
          await sql`select id from telegram_commands where user_id=${f.owner}`.execute(
            db,
          )
        ).rows.length,
        1,
      );
    },
  );
  await t.test(
    "Telegram safe task edits enforce target versions and preserve unrelated fields",
    async () => {
      const f = await fixture();
      const task = await saveRecord(
        db,
        "tasks",
        f.owner,
        {
          title: "Before",
          priority: "high",
          description: "Keep this",
          due_at: "2050-01-02T09:00:00Z",
          due_timezone: "UTC",
        },
        randomUUID(),
        { key: randomUUID() },
      );
      await f.send(`/rename ${task.id} | After`);
      let p = await f.latest();
      await f.send(`/confirm ${p.id}`);
      const changed = await getRecord(db, "tasks", f.owner, task.id);
      assert.equal(changed.title, "After");
      assert.equal(changed.description, "Keep this");
      assert.equal(changed.priority, "high");
      assert.equal(
        new Date(changed.due_at!).toISOString(),
        "2050-01-02T09:00:00.000Z",
      );
      await f.send(`/complete ${task.id}`);
      p = await f.latest();
      await sql`update tasks set version=version+1 where id=${task.id}`.execute(
        db,
      );
      await f.send(`/confirm ${p.id}`);
      assert.equal(
        (await getRecord(db, "tasks", f.owner, task.id)).status,
        "inbox",
      );
      assert.equal((await f.latest()).status, "failed");
    },
  );
  await t.test(
    "Telegram reminder timezone, reschedule and cancellation reuse reminder gates",
    async () => {
      const f = await fixture();
      await f.send("/remind 2050-01-02T09:00 | Report");
      let p = await f.latest();
      assert.equal(p.payload.due_at, "2050-01-02T03:30:00.000Z");
      await f.send(`/confirm ${p.id}`);
      const id = (await f.latest()).entity_id!;
      await f.send(`/reschedule ${id} | 2050-01-03T10:00`);
      p = await f.latest();
      await f.send(`/confirm ${p.id}`);
      assert.equal(
        new Date(
          (await getReminder(db, f.owner, id)).next_attempt_at!,
        ).toISOString(),
        "2050-01-03T04:30:00.000Z",
      );
      await f.send(`/cancel ${id}`);
      p = await f.latest();
      await f.send(`/confirm ${p.id}`);
      assert.equal((await getReminder(db, f.owner, id)).status, "cancelled");
    },
  );
  await t.test(
    "Telegram unlink suppresses queued changes and replies",
    async () => {
      const f = await fixture();
      await f.receive("/task Must not run");
      await removeTelegram(db, f.owner, randomUUID());
      await f.worker.runOnce();
      assert.equal(f.replies.length, 0);
      assert.equal(
        (
          await sql`select id from ai_action_proposals where user_id=${f.owner}`.execute(
            db,
          )
        ).rows.length,
        0,
      );
    },
  );
  await t.test(
    "Telegram reply timeout is unknown and never blindly resent",
    async () => {
      const f = await fixture();
      f.timeout();
      await f.send("/help");
      await f.worker.runOnce();
      assert.equal(f.replies.length, 1);
      assert.equal(
        (
          await sql<{
            status: string;
          }>`select status from telegram_command_replies where user_id=${f.owner}`.execute(
            db,
          )
        ).rows[0]!.status,
        "unknown",
      );
    },
  );
  await t.test(
    "Telegram interrupted inference is unknown without replay",
    async () => {
      const f = await fixture();
      await f.receive("Create a task");
      await sql`update telegram_commands set status='processing',lease_until=now()-interval '1 second' where user_id=${f.owner}`.execute(
        db,
      );
      await f.worker.runOnce();
      assert.equal(f.calls(), 0);
      assert.equal(
        (
          await sql<{
            status: string;
          }>`select status from telegram_commands where user_id=${f.owner}`.execute(
            db,
          )
        ).rows[0]!.status,
        "unknown",
      );
    },
  );
  await t.test(
    "Telegram webhook authenticates, queues durably, deduplicates and obeys recovery quarantine",
    async () => {
      const f = await fixture(),
        secret = "a".repeat(40);
      const app = createApp({
        db,
        logger: createLogger("silent"),
        checkReady: async () => {},
        messaging: {
          mode: "live",
          sandbox: false,
          telegram: f.bot,
          telegramCommands: true,
          telegramWebhookSecret: secret,
        },
      });
      const body = f.envelope("/help");
      await request(app).post("/webhooks/telegram").send(body).expect(403);
      for (let i = 0; i < 2; i++)
        await request(app)
          .post("/webhooks/telegram")
          .set("X-Telegram-Bot-Api-Secret-Token", secret)
          .send(body)
          .expect(200);
      assert.equal(
        (
          await sql`select id from telegram_commands where user_id=${f.owner}`.execute(
            db,
          )
        ).rows.length,
        1,
      );
      await sql`update recovery_control set quarantined=true where id=1`.execute(
        db,
      );
      try {
        await request(app)
          .post("/webhooks/telegram")
          .set("X-Telegram-Bot-Api-Secret-Token", secret)
          .send(f.envelope("/help"))
          .expect(503);
      } finally {
        await sql`update recovery_control set quarantined=false where id=1`.execute(
          db,
        );
      }
    },
  );
}
