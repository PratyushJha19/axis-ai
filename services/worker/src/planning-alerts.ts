import { randomUUID, createHash } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../packages/database/src/index.js";
import { PlanningService } from "../../../packages/domain/src/planning.js";
import { localDate } from "../../../packages/domain/src/planning-engine.js";
import {
  saveReminder,
  cancelReminder,
} from "../../../packages/domain/src/reminders.js";
import { Temporal } from "@js-temporal/polyfill";
import type { Reminder } from "../../../packages/shared/src/reminders.js";
import { DomainError } from "../../../packages/domain/src/errors.js";
export async function planningAlerts(db: Kysely<Database>, now = new Date()) {
  const users = (
    await sql<{
      user_id: string;
    }>`select user_id from planning_preferences where (value->>'alerts_enabled')::boolean order by evaluated_at,user_id limit 20`.execute(
      db,
    )
  ).rows;
  let count = 0;
  for (const { user_id: user } of users)
    await db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${user} for update`.execute(trx);
      const svc = new PlanningService(trx, () => now),
        pref = await svc.preferences(user);
      if (!pref.value.alerts_enabled) return;
      await sql`update planning_preferences set evaluated_at=${now} where user_id=${user}`.execute(
        trx,
      );
      const profile = (
        await sql<{
          timezone: string | null;
        }>`select timezone from users where id=${user}`.execute(trx)
      ).rows[0];
      if (!profile?.timezone) return;
      const b = await svc.briefing(user),
        zone = b.timezone,
        date = localDate(now, zone),
        clock = Temporal.Instant.fromEpochMilliseconds(+now)
          .toZonedDateTimeISO(zone)
          .toPlainTime()
          .toString({ smallestUnit: "minute" });
      const events: {
        key: string;
        title: string;
        body: string;
        task_id: string | null;
      }[] = [];
      if (pref.value.briefing_time && clock >= pref.value.briefing_time)
        events.push({
          key: `briefing:${date}`,
          title: "Your daily briefing is ready",
          body: `Open AXIS Planning to review ${b.due_today.length} due today and ${b.overdue.length} overdue tasks. Counts are a snapshot.`,
          task_id: null,
        });
      for (const t of b.priorities.filter(
        (t) =>
          ["high", "critical"].includes(t.priority) &&
          t.due_at &&
          Date.parse(t.due_at) <= +now + pref.value.lead_minutes * 60000,
      )) {
        const overdue = Date.parse(t.due_at!) < +now;
        events.push({
          key: `task:${t.id}:${createHash("sha256").update(t.due_at!).digest("hex").slice(0, 16)}:${overdue ? "overdue" : "approaching"}`,
          title: overdue
            ? "An important task is overdue"
            : "An important deadline is approaching",
          body: "Open AXIS Planning to review the task and its recorded deadline.",
          task_id: t.id,
        });
      }
      // Withdraw unsent alerts when the underlying commitment changes. Never recall a sent message.
      const previous = (
        await sql<
          Reminder & { event_key: string }
        >`select r.*,e.event_key from reminders r join planning_events e on e.user_id=r.user_id and e.reminder_id=r.id where r.user_id=${user} and r.archived_at is null limit 100`.execute(
          trx,
        )
      ).rows;
      for (const r of previous) {
        if (r.task_id && !events.some((e) => e.key === r.event_key))
          try {
            await cancelReminder(trx, user, r.id, r.version, randomUUID());
          } catch (e) {
            if (!(e instanceof DomainError && e.code === "CONFLICT")) throw e;
          }
      }
      const sentToday = (
        await sql<{
          n: number;
        }>`select count(*)::int n from planning_events where user_id=${user} and created_at>=${new Date(Temporal.PlainDate.from(date).toZonedDateTime(zone).epochMilliseconds)}`.execute(
          trx,
        )
      ).rows[0]!.n;
      let remaining = Math.max(0, 5 - sentToday);
      const existing = new Set(
        (
          await sql<{
            event_key: string;
          }>`select event_key from planning_events where user_id=${user} and event_key in (${sql.join(events.length ? events.map((e) => sql`${e.key}`) : [sql`null`])})`.execute(
            trx,
          )
        ).rows.map((e) => e.event_key),
      );
      for (const event of events) {
        if (!remaining) break;
        if (existing.has(event.key)) continue;
        const inserted =
          await sql`insert into planning_events(user_id,event_key,source_task,source_due,created_at) values(${user},${event.key},${event.task_id},${event.task_id ? b.priorities.find((t) => t.id === event.task_id)!.due_at : null},${now}) on conflict do nothing returning event_key`.execute(
            trx,
          );
        if (!inserted.rows.length) continue;
        const local = Temporal.Instant.fromEpochMilliseconds(+now)
          .toZonedDateTimeISO(zone)
          .toPlainDateTime()
          .toString({ smallestUnit: "minute" });
        const reminder = await saveReminder(
          trx,
          user,
          {
            title: event.title,
            body: event.body,
            task_id: event.task_id,
            project_id: null,
            local_due: local,
            timezone: zone,
            disambiguation: "earlier",
            recurrence: "none",
            confirmed: true,
          },
          randomUUID(),
          { key: randomUUID() },
        );
        await sql`update planning_events set reminder_id=${reminder.id} where user_id=${user} and event_key=${event.key}`.execute(
          trx,
        );
        remaining--;
        count++;
      }
    });
  return count;
}
