import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import {
  saveRecord,
  getRecord,
  deleteRecord,
} from "../../packages/domain/src/records.js";
import { enqueueReminder } from "../../packages/domain/src/notifications.js";
import { DeliveryEngine } from "../../services/worker/src/delivery.js";
import type { DeliveryJob } from "../../packages/shared/src/notifications.js";
import { createLogger } from "../../packages/observability/src/index.js";
import {
  getCanvas,
  saveCanvas,
  canvasTask,
  deleteCanvas,
} from "../../packages/domain/src/canvas.js";
import { taskDeadlineAllowed } from "../../packages/domain/src/task-deadline-policy.js";

export async function workspaceScenarios(t: TestContext, db: Kysely<Database>) {
  const user = randomUUID(),
    other = randomUUID(),
    correlation = randomUUID();
  for (const id of [user, other])
    await sql`insert into users(id,google_subject,email,display_name,timezone) values(${id},${id},'workspace@example.invalid','Fixture','Asia/Kolkata')`.execute(
      db,
    );
  const due = new Date(Date.now() + 72 * 3600000).toISOString();
  const input = {
    title: "Deadline fixture",
    due_at: due,
    due_timezone: "Asia/Kolkata",
  };
  let task = await saveRecord(db, "tasks", user, input, correlation, {
    key: randomUUID(),
  });
  await t.test(
    "deadline reminders are atomic, UTC based and idempotent across edits",
    async () => {
      const read = () =>
        sql<{
          hours_before: number;
          due_at: Date;
        }>`select a.hours_before,r.due_at from task_deadline_alerts a join reminders r on r.id=a.reminder_id where a.task_id=${task.id} order by hours_before`.execute(
          db,
        );
      const alerts = (await read()).rows;
      assert.equal(alerts.length, 2);
      for (const a of alerts)
        assert.equal(
          a.due_at.getTime(),
          new Date(due).getTime() - a.hours_before * 3600000,
        );
      task = await saveRecord(
        db,
        "tasks",
        user,
        { ...input, title: "Renamed" },
        correlation,
        { id: task.id, version: task.version },
      );
      assert.equal((await read()).rows.length, 2);
    },
  );
  await t.test(
    "deadline edits invalidate old queued alerts; completed tasks cannot begin dispatch",
    async () => {
      const old = (
        await sql<{
          id: string;
        }>`select reminder_id id from task_deadline_alerts where task_id=${task.id}`.execute(
          db,
        )
      ).rows;
      const later = new Date(new Date(due).getTime() + 3600000).toISOString();
      task = await saveRecord(
        db,
        "tasks",
        user,
        { ...input, due_at: later },
        correlation,
        { id: task.id, version: task.version },
      );
      for (const r of old)
        assert.equal(await taskDeadlineAllowed(db, user, r.id), false);
      task = await saveRecord(
        db,
        "tasks",
        user,
        { ...input, due_at: later, status: "completed" },
        correlation,
        { id: task.id, version: task.version },
      );
      const all = (
        await sql<{
          id: string;
          status: string;
        }>`select r.id,r.status from reminders r join task_deadline_alerts a on a.reminder_id=r.id where a.task_id=${task.id}`.execute(
          db,
        )
      ).rows;
      assert.equal(all.length, 4);
      for (const r of all) {
        assert.equal(r.status, "cancelled");
        assert.equal(await taskDeadlineAllowed(db, user, r.id), false);
      }
    },
  );
  await t.test(
    "title-only tasks and past offsets create no alerts; opt-out survives legacy updates",
    async () => {
      const noDate = await saveRecord(
        db,
        "tasks",
        user,
        { title: "No deadline" },
        correlation,
        { key: randomUUID() },
      );
      const near = await saveRecord(
        db,
        "tasks",
        user,
        { ...input, due_at: new Date(Date.now() + 3600000).toISOString() },
        correlation,
        { key: randomUUID() },
      );
      let off = await saveRecord(
        db,
        "tasks",
        user,
        { ...input, deadline_reminders: false },
        correlation,
        { key: randomUUID() },
      );
      off = await saveRecord(db, "tasks", user, input, correlation, {
        id: off.id,
        version: off.version,
      });
      assert.equal(off.deadline_reminders, false);
      for (const id of [noDate.id, near.id, off.id])
        assert.equal(
          (
            await sql`select * from task_deadline_alerts where task_id=${id}`.execute(
              db,
            )
          ).rows.length,
          0,
        );
    },
  );
  await t.test(
    "canvas persistence, conflict handling, ownership and canonical conversion",
    async () => {
      const id = randomUUID(),
        nodeId = randomUUID();
      const input = {
        name: "Project map",
        project_id: null,
        viewport: { x: 50, y: 80, zoom: 0.75 },
        nodes: [
          {
            id: nodeId,
            kind: "Idea",
            title: "Build something",
            content: "Notes",
            x: 100,
            y: 200,
            width: 200,
            height: 100,
            task_id: null,
          },
        ],
        edges: [],
      };
      const c = await saveCanvas(db, user, id, input, null, correlation);
      assert.deepEqual(
        (await getCanvas(db, user, id)).viewport,
        input.viewport,
      );
      await assert.rejects(() => getCanvas(db, other, id));
      await assert.rejects(() =>
        saveCanvas(
          db,
          user,
          id,
          {
            ...input,
            nodes: [
              {
                ...input.nodes[0],
                task_id: task.id,
              },
            ],
          },
          0,
          correlation,
        ),
      );
      const results = await Promise.all([
        canvasTask(
          db,
          user,
          id,
          nodeId,
          c.version,
          { title: "Canonical task" },
          correlation,
        ),
        canvasTask(
          db,
          user,
          id,
          nodeId,
          c.version,
          { title: "Canonical task" },
          correlation,
        ),
      ]);
      assert.equal(results[0]!.id, results[1]!.id);
      const linked = await getCanvas(db, user, id);
      assert.equal(linked.nodes[0]!.task_id, results[0]!.id);
      await assert.rejects(() =>
        saveCanvas(
          db,
          other,
          randomUUID(),
          { ...input, nodes: [{ ...input.nodes[0], task_id: results[0]!.id }] },
          null,
          correlation,
        ),
      );
      await deleteCanvas(db, user, id, linked.version, correlation);
      assert.equal(
        (await getRecord(db, "tasks", user, results[0]!.id)).title,
        "Canonical task",
      );
    },
  );
  await t.test(
    "a task completed after outbox enqueue cannot start a channel send",
    async () => {
      const source = await saveRecord(db, "tasks", user, input, correlation, {
        key: randomUUID(),
      });
      const reminder = (
        await sql<{
          id: string;
          due_at: Date;
          idempotency_key: string;
        }>`select r.* from reminders r join task_deadline_alerts a on a.reminder_id=r.id where a.task_id=${source.id} order by r.due_at limit 1`.execute(
          db,
        )
      ).rows[0]!;
      const now = new Date(reminder.due_at.getTime() + 1000);
      await sql`insert into notification_preferences(user_id,telegram_destination,telegram_bot_id,telegram_verified_at,telegram_enabled,revision) values(${user},'99998','99997',now(),true,${randomUUID()})`.execute(
        db,
      );
      await enqueueReminder(
        db,
        reminder.id,
        user,
        1,
        `${reminder.idempotency_key}:1`,
        now,
        "telegram",
      );
      await sql`update reminders set status='processing' where id=${reminder.id}`.execute(
        db,
      );
      const job = (
        await sql<DeliveryJob>`update notification_jobs set lease_token=${randomUUID()},lease_until=${new Date(now.getTime() + 60000)} where reminder_id=${reminder.id} returning *`.execute(
          db,
        )
      ).rows[0]!;
      await saveRecord(
        db,
        "tasks",
        user,
        { ...input, status: "completed" },
        correlation,
        { id: source.id, version: source.version },
      );
      const engine = new DeliveryEngine(
        db,
        {},
        createLogger("silent"),
        () => now,
      );
      assert.equal(await engine.prepare(job), null);
      assert.equal(
        (
          await sql<{
            status: string;
          }>`select status from notification_jobs where id=${job.id}`.execute(
            db,
          )
        ).rows[0]!.status,
        "blocked",
      );
    },
  );
  await t.test(
    "reopening re-enrols future offsets; deletion preserves a suppression tombstone",
    async () => {
      const reopened = await saveRecord(db, "tasks", user, input, correlation, {
        id: task.id,
        version: task.version,
      });
      const rows = (
        await sql<{
          id: string;
        }>`select r.id from reminders r join task_deadline_alerts a on a.reminder_id=r.id where a.task_id=${task.id} and r.status='scheduled'`.execute(
          db,
        )
      ).rows;
      assert.equal(rows.length, 2);
      await deleteRecord(
        db,
        "tasks",
        user,
        reopened.id,
        reopened.version,
        correlation,
      );
      for (const r of rows)
        assert.equal(await taskDeadlineAllowed(db, user, r.id), false);
    },
  );
}
