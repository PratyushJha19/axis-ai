import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import {
  saveReminder,
  getReminder,
  cancelReminder,
} from "../../packages/domain/src/reminders.js";
import { purgeArchivedReminders } from "../../services/worker/src/reminder-retention.js";

export async function reminderRetentionScenarios(
  t: TestContext,
  db: Kysely<Database>,
) {
  const owner = randomUUID();
  await sql`insert into users(id,google_subject,email,display_name,timezone) values(${owner},${owner},'retention@example.invalid','Retention','UTC')`.execute(
    db,
  );
  const create = () =>
    saveReminder(
      db,
      owner,
      {
        title: "Retention fixture",
        local_due: "2099-01-01T09:00",
        timezone: "UTC",
        confirmed: true,
      },
      randomUUID(),
      { key: randomUUID() },
    );
  await t.test(
    "archive marks only settled/cancelled reminders, retains future recurrence and unresolved failures",
    async () => {
      const sent = await create();
      await sql`update reminders set status='sent',reason='telegram_sent',next_attempt_at=null where id=${sent.id}`.execute(
        db,
      );
      assert.ok((await getReminder(db, owner, sent.id)).archived_at);
      for (const status of ["unknown", "failed"]) {
        const row = await create();
        await sql`update reminders set status=${status},next_attempt_at=null,attention=true where id=${row.id}`.execute(
          db,
        );
        assert.equal((await getReminder(db, owner, row.id)).archived_at, null);
      }
      const repeating = await create();
      await sql`update reminders set status='sent',reason='telegram_sent',recurrence='daily',next_attempt_at=null where id=${repeating.id}`.execute(
        db,
      );
      assert.equal(
        (await getReminder(db, owner, repeating.id)).archived_at,
        null,
      );
      await sql`update reminders set status='scheduled',next_attempt_at=due_at where id=${repeating.id}`.execute(
        db,
      );
      assert.equal(
        (await getReminder(db, owner, repeating.id)).archived_at,
        null,
      );
    },
  );
  await t.test(
    "seven-day retention is bounded, concurrency safe and removes child delivery history only after expiry",
    async () => {
      const row = await create();
      await cancelReminder(db, owner, row.id, row.version, randomUUID());
      const saved = await getReminder(db, owner, row.id),
        archived = new Date(saved.archived_at!);
      const job = randomUUID();
      await sql`insert into notification_jobs(id,user_id,reminder_id,occurrence,logical_key,channel,provider,kind,destination,preference_revision,status) values(${job},${owner},${row.id},1,${job},'telegram','telegram','reminder','12345',${randomUUID()},'sent')`.execute(
        db,
      );
      await sql`insert into notification_attempts(id,user_id,reminder_id,job_id,occurrence,occurrence_due_at,channel,provider,status,attempt_number,idempotency_key,started_at) values(${randomUUID()},${owner},${row.id},${job},1,${row.due_at},'telegram','telegram','sent',1,${randomUUID()},now())`.execute(
        db,
      );
      await purgeArchivedReminders(
        db,
        new Date(archived.getTime() + 7 * 86400000 - 1),
        owner,
      );
      assert.ok(await getReminder(db, owner, row.id));
      await Promise.all([
        purgeArchivedReminders(
          db,
          new Date(archived.getTime() + 7 * 86400000 + 1),
          owner,
        ),
        purgeArchivedReminders(
          db,
          new Date(archived.getTime() + 7 * 86400000 + 1),
          owner,
        ),
      ]);
      await assert.rejects(getReminder(db, owner, row.id), /not found/);
      assert.equal(
        (
          await sql`select id from notification_jobs where id=${job}`.execute(
            db,
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await sql`select id from notification_attempts where job_id=${job}`.execute(
            db,
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await sql`select id from audit_events where entity_id=${row.id} and event_type='reminder_archive_deleted'`.execute(
            db,
          )
        ).rows.length,
        1,
      );
    },
  );
  await t.test(
    "archive purge preserves unresolved transport evidence even after seven days",
    async () => {
      const row = await create();
      await cancelReminder(db, owner, row.id, row.version, randomUUID());
      const job = randomUUID();
      await sql`insert into notification_jobs(id,user_id,reminder_id,occurrence,logical_key,channel,provider,kind,destination,preference_revision,status) values(${job},${owner},${row.id},1,${job},'telegram','telegram','reminder','12345',${randomUUID()},'unknown')`.execute(
        db,
      );
      await purgeArchivedReminders(
        db,
        new Date(Date.now() + 8 * 86400000),
        owner,
      );
      assert.ok(await getReminder(db, owner, row.id));
    },
  );
}
