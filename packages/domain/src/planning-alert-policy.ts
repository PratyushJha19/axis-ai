import { sql, type Kysely } from "kysely";
import type { Database } from "../../database/src/index.js";
import { localDate } from "./planning-engine.js";
// Call only before a fresh dispatch, never to erase an uncertain delivery outcome.
export async function planningAlertAllowed(
  db: Kysely<Database>,
  user: string,
  reminder: string,
  now: Date,
) {
  const event = (
    await sql<{
      event_key: string;
      enabled: boolean;
      timezone: string | null;
      valid_task: boolean;
    }>`select e.event_key,coalesce((p.value->>'alerts_enabled')::boolean,false) enabled,u.timezone,(t.id is not null and t.archived_at is null and t.status not in ('completed','cancelled') and t.priority in ('high','critical') and t.due_at=e.source_due) valid_task from planning_events e left join planning_preferences p on p.user_id=e.user_id join users u on u.id=e.user_id left join tasks t on t.id=e.source_task and t.user_id=e.user_id where e.user_id=${user} and e.reminder_id=${reminder}`.execute(
      db,
    )
  ).rows[0];
  if (!event) return true;
  if (!event.enabled || !event.timezone) return false;
  return event.event_key.startsWith("briefing:")
    ? event.event_key === `briefing:${localDate(now, event.timezone)}`
    : event.valid_task;
}
