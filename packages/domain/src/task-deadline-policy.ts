import { sql, type Kysely } from "kysely";
import type { Database } from "../../database/src/index.js";

// Revalidate at both scheduler and channel dispatch boundaries. Reconciliation
// must still run for attempts whose outcome is already uncertain.
export async function taskDeadlineAllowed(
  db: Kysely<Database>,
  user: string,
  reminder: string,
) {
  const row = (
    await sql<{ allowed: boolean }>`select
    (t.deadline_reminders and t.archived_at is null and t.status not in ('completed','cancelled') and t.due_at=a.source_due) allowed
    from task_deadline_alerts a left join tasks t on t.user_id=a.user_id and t.id=a.task_id
    where a.user_id=${user} and a.reminder_id=${reminder}`.execute(db)
  ).rows[0];
  return row ? row.allowed === true : true;
}
