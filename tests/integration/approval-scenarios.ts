import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import {
  createDatabase,
  type Database,
} from "../../packages/database/src/index.js";
import {
  operateApproval,
  payloadHash,
} from "../../packages/domain/src/chat-actions.js";
import { actionPolicy } from "../../packages/domain/src/action-policy.js";
import { proposeAction } from "../../packages/domain/src/approvals.js";
import type { ChatAction } from "../../packages/shared/src/chat-actions.js";

export async function approvalScenarios(
  t: TestContext,
  db: Kysely<Database>,
  connection: string,
) {
  const user = randomUUID(),
    other = randomUUID(),
    correlation = randomUUID();
  await sql`insert into users(id,google_subject,email,display_name) values(${user},${user},'approval@example.invalid','Approval fixture')`.execute(
    db,
  );
  const payload: ChatAction["payload"] = {
    kind: "task",
    title: "Approval fixture",
    description: "",
    local_due: null,
    timezone: null,
    due_at: null,
  };
  const hash = payloadHash(payload);
  await t.test(
    "runtime proposals reject injected authority and deduplicate without executing",
    async () => {
      const input = {
        idempotency_key: randomUUID(),
        action_type: "task.create",
        payload: { kind: "task", title: "Runtime draft" },
      };
      const [a, b] = await Promise.all([
        proposeAction(db, user, input, correlation),
        proposeAction(db, user, input, correlation),
      ]);
      assert.equal(a.id, b.id);
      assert.equal(a.status, "pending");
      assert.equal(
        (await sql`select id from tasks where user_id=${user}`.execute(db)).rows
          .length,
        0,
      );
      await assert.rejects(
        proposeAction(db, user, { ...input, approved: true }, correlation),
      );
      await assert.rejects(
        proposeAction(
          db,
          user,
          { ...input, payload: { kind: "task", title: "Different" } },
          correlation,
        ),
        { code: "CONFLICT" },
      );
      await assert.rejects(
        proposeAction(
          db,
          user,
          { ...input, action_type: "email.send" },
          correlation,
        ),
        { code: "ACTION_NOT_SUPPORTED" },
      );
    },
  );
  async function draft(policy = "m4-internal-v1", expired = false) {
    const id = randomUUID();
    await sql`insert into ai_action_proposals(id,user_id,payload,payload_hash,policy_version,expires_at) values(${id},${user},${JSON.stringify(payload)}::jsonb,${hash},${policy},clock_timestamp()+${expired ? "-1 second" : "24 hours"}::interval)`.execute(
      db,
    );
    return id;
  }
  const act = (
    id: string,
    operation: "approve" | "execute" | "cancel" | "reject",
    owner = user,
    suppliedHash = hash,
  ) =>
    operateApproval(
      db,
      owner,
      id,
      {
        decision: operation === "reject" ? "reject" : "confirm",
        payload_hash: suppliedHash,
      },
      correlation,
      operation,
    );
  await t.test(
    "approval requires consent, exact payload and owner; policy denies unknown and high-risk actions",
    async () => {
      const id = await draft();
      await assert.rejects(act(id, "execute"), { code: "APPROVAL_REQUIRED" });
      await assert.rejects(act(id, "approve", other), { code: "NOT_FOUND" });
      await assert.rejects(act(id, "approve", user, "0".repeat(64)), {
        code: "PAYLOAD_MISMATCH",
      });
      for (const type of [
        "email.send",
        "payment.transfer",
        "calendar.delete",
        "arbitrary.tool",
      ])
        assert.throws(() => actionPolicy(type), {
          code: "ACTION_NOT_SUPPORTED",
        });
      await assert.rejects(act(await draft("obsolete-policy"), "approve"), {
        code: "POLICY_CHANGED",
      });
      await assert.rejects(
        sql`update ai_action_proposals set policy_version='evil' where id=${id}`.execute(
          db,
        ),
        /Immutable/,
      );
      await assert.rejects(
        sql`update ai_action_proposals set context_hash='evil' where id=${id}`.execute(
          db,
        ),
        /Immutable/,
      );
    },
  );
  await t.test(
    "approved action survives reconnect; concurrent execution and replay produce one effect and lifecycle audit",
    async () => {
      const id = await draft();
      await act(id, "approve");
      const reconnect = createDatabase(connection);
      try {
        assert.equal(
          (
            await sql<{
              status: string;
            }>`select status from ai_action_proposals where id=${id}`.execute(
              reconnect,
            )
          ).rows[0]?.status,
          "approved",
        );
        const [a, b] = await Promise.all([
          act(id, "execute"),
          operateApproval(
            reconnect,
            user,
            id,
            { decision: "confirm", payload_hash: hash },
            correlation,
            "execute",
          ),
        ]);
        assert.equal(a.entity_id, b.entity_id);
        assert.equal(
          (await sql`select id from tasks where user_id=${user}`.execute(db))
            .rows.length,
          1,
        );
        const events = (
          await sql<{
            event_type: string;
          }>`select event_type from audit_events where entity_id=${id}`.execute(
            db,
          )
        ).rows.map((r) => r.event_type);
        for (const event of [
          "action_approved",
          "action_execution_started",
          "action_executed",
        ])
          assert.ok(events.includes(event));
        assert.equal(
          events.filter((e) => e === "action_execution_started").length,
          1,
        );
        await assert.rejects(act(id, "cancel"), { code: "CONFLICT" });
      } finally {
        await reconnect.destroy();
      }
    },
  );
  await t.test(
    "expiry is persistent and audited; rejected and cancelled approvals cannot execute",
    async () => {
      const expired = await draft(undefined, true);
      await assert.rejects(act(expired, "approve"), {
        code: "APPROVAL_EXPIRED",
      });
      assert.equal(
        (
          await sql<{
            status: string;
          }>`select status from ai_action_proposals where id=${expired}`.execute(
            db,
          )
        ).rows[0]?.status,
        "expired",
      );
      assert.equal(
        (
          await sql`select id from audit_events where entity_id=${expired} and event_type='action_expired'`.execute(
            db,
          )
        ).rows.length,
        1,
      );
      for (const operation of ["reject", "cancel"] as const) {
        const id = await draft();
        if (operation === "cancel") await act(id, "approve");
        await act(id, operation);
        await assert.rejects(act(id, "execute"), { code: "CONFLICT" });
      }
    },
  );
  await t.test(
    "failed local transaction records failure and cannot retry or create a partial record",
    async () => {
      const id = await draft();
      await act(id, "approve");
      // Simulate an existing idempotency key for a different immutable payload.
      await sql`insert into request_keys(user_id,key,operation,payload_hash,entity_id) values(${user},${id},'tasks:create','different',${randomUUID()})`.execute(
        db,
      );
      await assert.rejects(act(id, "execute"));
      assert.equal(
        (
          await sql<{
            status: string;
          }>`select status from ai_action_proposals where id=${id}`.execute(db)
        ).rows[0]?.status,
        "failed",
      );
      await assert.rejects(act(id, "execute"), { code: "CONFLICT" });
      assert.equal(
        (await sql`select id from tasks where user_id=${user}`.execute(db)).rows
          .length,
        1,
      );
    },
  );
  await t.test(
    "cancellation racing execution has one winner; unknown outcomes never execute",
    async () => {
      const id = await draft();
      await act(id, "approve");
      const results = await Promise.allSettled([
        act(id, "cancel"),
        act(id, "execute"),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const row = (
        await sql<{
          status: string;
          entity_id: string | null;
        }>`select status,entity_id from ai_action_proposals where id=${id}`.execute(
          db,
        )
      ).rows[0]!;
      assert.ok(["cancelled", "succeeded"].includes(row.status));
      assert.equal(row.entity_id !== null, row.status === "succeeded");
      const uncertain = await draft();
      await act(uncertain, "approve");
      await sql`update ai_action_proposals set status='executing' where id=${uncertain}`.execute(
        db,
      );
      await sql`update ai_action_proposals set status='unknown' where id=${uncertain}`.execute(
        db,
      );
      await assert.rejects(act(uncertain, "execute"), { code: "CONFLICT" });
      await assert.rejects(act(uncertain, "approve"), { code: "CONFLICT" });
      await assert.rejects(act(uncertain, "cancel"), { code: "CONFLICT" });
    },
  );
}
