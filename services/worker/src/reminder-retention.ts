import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import { audit } from "../../../packages/domain/src/records.js";

// Small atomic batches. Pending transport/reconciliation always blocks deletion.
export async function purgeArchivedReminders(
  db: Kysely<Database>,
  now = new Date(),
  owner?: string,
) {
  return db.transaction().execute(async (trx) => {
    const cutoff = new Date(now.getTime() - 7 * 86400000);
    const rows = (
      await sql<{
        id: string;
        user_id: string;
      }>`select id,user_id from reminders r
      where archived_at <= ${cutoff} and next_attempt_at is null and lease_token is null
      and ${owner ? sql`user_id=${owner}` : sql`true`}
      and (status='cancelled' or (recurrence='none' and not attention and (status='delivered' or (status='sent' and reason='telegram_sent'))))
      and not exists(select 1 from notification_jobs j where j.reminder_id=r.id and
        (j.next_attempt_at is not null or j.lease_token is not null or j.status in ('queued','submitting','accepted','retry_scheduled','unknown') or (j.status='sent' and j.provider<>'telegram')))
      order by archived_at,id limit 50 for update of r skip locked`.execute(trx)
    ).rows;
    let deleted = 0;
    for (const row of rows) {
      // Lock child rows before deleting; in-flight jobs were excluded above.
      const jobs = (
        await sql<{
          id: string;
        }>`select id from notification_jobs where reminder_id=${row.id} and user_id=${row.user_id} for update`.execute(
          trx,
        )
      ).rows;
      // Recheck after locks in case another worker just scheduled reconciliation.
      const unsafe = (
        await sql`select id from notification_jobs where reminder_id=${row.id} and (next_attempt_at is not null or lease_token is not null or status in ('queued','submitting','accepted','retry_scheduled','unknown') or (status='sent' and provider<>'telegram'))`.execute(
          trx,
        )
      ).rows;
      if (unsafe.length) continue;
      await sql`delete from notification_attempts where user_id=${row.user_id} and reminder_id=${row.id}`.execute(
        trx,
      );
      for (const job of jobs)
        await sql`delete from notification_attempts where user_id=${row.user_id} and job_id=${job.id}`.execute(
          trx,
        );
      await sql`update notification_jobs set fallback_of=null where user_id=${row.user_id} and reminder_id=${row.id}`.execute(
        trx,
      );
      await sql`delete from notification_jobs where user_id=${row.user_id} and reminder_id=${row.id}`.execute(
        trx,
      );
      await sql`delete from reminders where user_id=${row.user_id} and id=${row.id}`.execute(
        trx,
      );
      await audit(
        trx,
        row.user_id,
        "reminder_archive_deleted",
        row.id,
        randomUUID(),
      );
      deleted++;
    }
    return deleted;
  });
}
