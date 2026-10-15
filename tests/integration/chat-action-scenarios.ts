import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import {
  createDatabase,
  type Database,
} from "../../packages/database/src/index.js";
import { AIService } from "../../packages/domain/src/ai.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";
import { decideChatAction } from "../../packages/domain/src/chat-actions.js";
export async function chatActionScenarios(
  t: TestContext,
  db: Kysely<Database>,
  connection: string,
) {
  const user = randomUUID(),
    other = randomUUID(),
    correlation = randomUUID();
  for (const id of [user, other])
    await sql`insert into users(id,google_subject,email,display_name,timezone) values(${id},${id},'chat@example.invalid','Fixture','Asia/Kolkata')`.execute(
      db,
    );
  let proposal: unknown = {
    kind: "task",
    title: "Chat task",
    description: "Created after review",
  };
  const service = new AIService(db, {
    vault: new KeyVault(new Map([["v1", randomBytes(32)]]), "v1"),
    rate: 100,
    adapter: {
      async generate() {
        return {
          content: JSON.stringify({ reply: "Created", proposal }),
          usage: null,
        };
      },
    },
  });
  await service.save(
    user,
    {
      provider: "groq",
      model: "test-model",
      apiKey: "synthetic-chat-action-key",
    },
    correlation,
  );
  const draft = async () =>
    service.chat(
      user,
      { request_id: randomUUID(), message: "Create this item", consent: true },
      correlation,
    );
  await t.test(
    "chat proposal is durable without a write; concurrent confirmation creates one task and replays safely",
    async () => {
      const result = await draft(),
        action = result.actions[0]!;
      assert.equal(
        (await sql`select id from tasks where user_id=${user}`.execute(db)).rows
          .length,
        0,
      );
      assert.match(
        String((result.messages[1] as { content: string })?.content),
        /Nothing has been created yet/,
      );
      const reconnect = createDatabase(connection);
      try {
        assert.equal(
          (await new AIService(reconnect).history(user, result.conversation_id))
            .actions[0]?.id,
          action.id,
        );
      } finally {
        await reconnect.destroy();
      }
      const body = { decision: "confirm", payload_hash: action.payload_hash };
      const [a, b] = await Promise.all([
        decideChatAction(db, user, action.id, body, correlation),
        decideChatAction(db, user, action.id, body, correlation),
      ]);
      assert.equal(a.entity_id, b.entity_id);
      assert.equal(
        (await sql`select id from tasks where user_id=${user}`.execute(db)).rows
          .length,
        1,
      );
      assert.equal(
        (await service.history(user, result.conversation_id)).actions[0]
          ?.status,
        "succeeded",
      );
    },
  );
  await t.test(
    "chat confirmation denies cross-owner, payload changes, body injection and rejected proposals",
    async () => {
      const action = (await draft()).actions[0]!,
        body = { decision: "confirm", payload_hash: action.payload_hash };
      await assert.rejects(
        decideChatAction(db, other, action.id, body, correlation),
        /not found/,
      );
      await assert.rejects(
        decideChatAction(
          db,
          user,
          action.id,
          { ...body, payload_hash: "0".repeat(64) },
          correlation,
        ),
        /changed/,
      );
      await assert.rejects(
        decideChatAction(
          db,
          user,
          action.id,
          { ...body, payload: {} },
          correlation,
        ),
      );
      await assert.rejects(
        sql`update ai_action_proposals set payload='{}'::jsonb where id=${action.id}`.execute(
          db,
        ),
        /Immutable/,
      );
      await decideChatAction(
        db,
        user,
        action.id,
        { ...body, decision: "reject" },
        correlation,
      );
      await assert.rejects(
        decideChatAction(db, user, action.id, body, correlation),
        /already decided/,
      );
    },
  );
  await t.test(
    "chat reminder confirms exact UTC schedule and recurrence through existing reminder domain",
    async () => {
      proposal = {
        kind: "reminder",
        title: "Chat reminder",
        local_due: "2099-10-16T09:00",
        recurrence: "daily",
      };
      const action = (await draft()).actions[0]!;
      assert.equal(action.payload.due_at, "2099-10-16T03:30:00.000Z");
      assert.equal(
        (await sql`select id from reminders where user_id=${user}`.execute(db))
          .rows.length,
        0,
      );
      const saved = await decideChatAction(
        db,
        user,
        action.id,
        { decision: "confirm", payload_hash: action.payload_hash },
        correlation,
      );
      const row = (
        await sql<{
          recurrence: string;
          status: string;
        }>`select recurrence,status from reminders where user_id=${user} and id=${saved.entity_id}`.execute(
          db,
        )
      ).rows[0]!;
      assert.equal(row.recurrence, "daily");
      assert.equal(row.status, "scheduled");
    },
  );
  await t.test(
    "expired proposals and timezone changes cannot execute; no partial record survives failure",
    async () => {
      const action = (await draft()).actions[0]!;
      const expired = randomUUID();
      // A separately inserted historical fixture; immutable expiry cannot be edited.
      await sql`insert into ai_requests(id,user_id,conversation_id,payload_hash,status,include_context,expires_at) values(${expired},${user},${action.conversation_id},'fixture','succeeded',false,now())`.execute(
        db,
      );
      await sql`insert into ai_action_proposals(id,user_id,conversation_id,request_id,payload,payload_hash,expires_at) values(${expired},${user},${action.conversation_id},${expired},${JSON.stringify(action.payload)}::jsonb,${action.payload_hash},now()-interval '1 second')`.execute(
        db,
      );
      await assert.rejects(
        decideChatAction(
          db,
          user,
          expired,
          { decision: "confirm", payload_hash: action.payload_hash },
          correlation,
        ),
        /expired/,
      );
      await sql`update users set timezone='UTC' where id=${user}`.execute(db);
      await assert.rejects(
        decideChatAction(
          db,
          user,
          action.id,
          { decision: "confirm", payload_hash: action.payload_hash },
          correlation,
        ),
        /timezone changed/,
      );
      assert.equal(
        (await sql`select id from reminders where user_id=${user}`.execute(db))
          .rows.length,
        1,
      );
    },
  );
}
