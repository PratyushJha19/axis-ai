import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../database/src/index.js";
import { inTransaction } from "../../database/src/index.js";
import {
  reminderSchema,
  preferenceSchema,
  isSettledTelegramReminder,
  type Reminder,
  type Preferences,
} from "../../shared/src/reminders.js";
import { DomainError } from "./errors.js";
import { audit, getRecord } from "./records.js";
import { localToUtc } from "./reminder-time.js";

export type ReminderDB = Kysely<Database> | Transaction<Database>;
export const emptyPreferences: Preferences = {
  quiet_start: null,
  quiet_end: null,
  focus_blocks: [],
};
export async function reconcileReminder(
  db: Kysely<Database>,
  userId: string,
  id: string,
  version: number,
  correlation: string,
  now = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    const row = await getReminder(trx, userId, id, true);
    if (
      row.version !== version ||
      !row.attention ||
      !["unknown", "sent"].includes(row.status)
    )
      throw new DomainError(
        "CONFLICT",
        409,
        "Only an unresolved reminder needing attention can be reconciled again. Reload its status.",
      );
    await sql`update reminders set reconcile_count=0,next_attempt_at=${now},attention=false,reason='owner_requested_reconciliation',version=version+1,updated_at=${now} where user_id=${userId} and id=${id}`.execute(
      trx,
    );
    await audit(
      trx,
      userId,
      "reminder_reconciliation_requested",
      id,
      correlation,
    );
    return getReminder(trx, userId, id);
  });
}
export async function getReminder(
  db: ReminderDB,
  userId: string,
  id: string,
  lock = false,
) {
  const { rows } =
    await sql<Reminder>`select * from reminders where user_id=${userId} and id=${id} ${lock ? sql`for update` : sql``}`.execute(
      db,
    );
  if (!rows[0]) throw new DomainError("NOT_FOUND", 404, "Reminder not found.");
  return rows[0];
}
export async function getPreferences(db: ReminderDB, userId: string) {
  const result = await sql<
    Preferences & { version: number }
  >`select quiet_start,quiet_end,focus_blocks,version from reminder_preferences where user_id=${userId}`.execute(
    db,
  );
  return result.rows[0] || { ...emptyPreferences, version: 0 };
}
export async function savePreferences(
  db: Kysely<Database>,
  userId: string,
  input: unknown,
  version: number,
  correlation: string,
) {
  const value = preferenceSchema.parse(input);
  const sorted = [...value.focus_blocks].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  );
  if (
    sorted.some(
      (b, i) => i > 0 && Date.parse(b.start) < Date.parse(sorted[i - 1]!.end),
    )
  )
    throw new DomainError("CONFLICT", 409, "Focus blocks cannot overlap.");
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${userId} for update`.execute(trx);
    const previous = await getPreferences(trx, userId);
    if (previous.version !== version)
      throw new DomainError(
        "CONFLICT",
        409,
        "Preferences changed. Reload before saving.",
      );
    await sql`insert into reminder_preferences(user_id,quiet_start,quiet_end,focus_blocks) values (${userId},${value.quiet_start},${value.quiet_end},${JSON.stringify(sorted)}::jsonb)
      on conflict (user_id) do update set quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end,focus_blocks=excluded.focus_blocks,version=reminder_preferences.version+1,updated_at=now()`.execute(
      trx,
    );
    await audit(trx, userId, "reminder_preferences_updated", null, correlation);
    return getPreferences(trx, userId);
  });
}
async function editable(db: ReminderDB, row: Reminder, version: number) {
  if (row.version !== version)
    throw new DomainError(
      "CONFLICT",
      409,
      "Reminder changed. Reload before editing.",
    );
  if (isSettledTelegramReminder(row))
    throw new DomainError(
      "CONFLICT",
      409,
      "This one-time reminder was already sent to Telegram. There are no future occurrences to cancel, and the sent message cannot be recalled.",
    );
  const queued =
    row.channel_policy === "whatsapp_email" &&
    !(
      await sql`select id from notification_jobs where reminder_id=${row.id} and user_id=${row.user_id} and occurrence=${row.occurrence} and attempt_count>0 limit 1`.execute(
        db,
      )
    ).rows.length;
  if (["processing", "sent", "unknown"].includes(row.status) && !queued)
    throw new DomainError(
      "CONFLICT",
      409,
      "Dispatch has started or its outcome is unresolved. Wait for reconciliation before changing this reminder.",
    );
  if (["cancelled", "delivered"].includes(row.status))
    throw new DomainError(
      "CONFLICT",
      409,
      "This reminder is finished. Create a new reminder.",
    );
}
export async function saveReminder(
  db: Kysely<Database>,
  userId: string,
  input: unknown,
  correlation: string,
  options: { key: string } | { id: string; version: number },
) {
  const value = reminderSchema.parse(input);
  const due = localToUtc(value.local_due, value.timezone, value.disambiguation);
  return inTransaction(db, async (trx) => {
    let id: string = randomUUID();
    await sql`select id from users where id=${userId} for update`.execute(trx);
    let previous: Reminder | undefined;
    if ("id" in options) {
      id = options.id;
      previous = await getReminder(trx, userId, id, true);
      await editable(trx, previous, options.version);
    } else {
      const hash = createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
      const key =
        await sql`insert into request_keys(user_id,key,operation,payload_hash,entity_id) values (${userId},${options.key},'reminders',${hash},${id}) on conflict do nothing returning entity_id`.execute(
          trx,
        );
      if (!key.rows.length) {
        const existing = await sql<{
          operation: string;
          payload_hash: string;
          entity_id: string;
        }>`select operation,payload_hash,entity_id from request_keys where user_id=${userId} and key=${options.key}`.execute(
          trx,
        );
        if (
          existing.rows[0]?.operation !== "reminders" ||
          existing.rows[0]?.payload_hash !== hash
        )
          throw new DomainError(
            "CONFLICT",
            409,
            "This request key was already used for different content.",
          );
        return getReminder(trx, userId, existing.rows[0].entity_id);
      }
    }
    const owner = await sql<{
      timezone: string | null;
    }>`select timezone from users where id=${userId}`.execute(trx);
    if (!owner.rows[0]?.timezone || owner.rows[0].timezone !== value.timezone)
      throw new DomainError(
        "TIMEZONE_REQUIRED",
        422,
        "Use the timezone configured in your profile. Reload after changing it.",
      );
    if (value.task_id) await getRecord(trx, "tasks", userId, value.task_id);
    if (value.project_id)
      await getRecord(trx, "projects", userId, value.project_id);
    if (previous) {
      await sql`update reminders set title=${value.title},body=${value.body},task_id=${value.task_id},project_id=${value.project_id},due_at=${due},local_due=${value.local_due},timezone=${value.timezone},recurrence=${value.recurrence},disambiguation=${value.disambiguation},status='scheduled',next_attempt_at=${due},lease_token=null,lease_until=null,attention=false,reason=null,occurrence=occurrence+1,send_count=0,reconcile_count=0,version=version+1,updated_at=now() where user_id=${userId} and id=${id}`.execute(
        trx,
      );
    } else {
      await sql`insert into reminders(id,user_id,title,body,task_id,project_id,due_at,local_due,timezone,recurrence,disambiguation,next_attempt_at,idempotency_key,correlation_id)
        values (${id},${userId},${value.title},${value.body},${value.task_id},${value.project_id},${due},${value.local_due},${value.timezone},${value.recurrence},${value.disambiguation},${due},${randomUUID()},${correlation})`.execute(
        trx,
      );
    }
    await audit(
      trx,
      userId,
      previous ? "reminder_rescheduled" : "reminder_created",
      id,
      correlation,
    );
    return getReminder(trx, userId, id);
  });
}
export async function cancelReminder(
  db: Kysely<Database>,
  userId: string,
  id: string,
  version: number,
  correlation: string,
) {
  return inTransaction(db, async (trx) => {
    await sql`select id from users where id=${userId} for update`.execute(trx);
    const row = await getReminder(trx, userId, id, true);
    await editable(trx, row, version);
    await sql`update reminders set status='cancelled',cancelled_at=now(),next_attempt_at=null,lease_token=null,lease_until=null,attention=false,reason=null,version=version+1,updated_at=now() where user_id=${userId} and id=${id}`.execute(
      trx,
    );
    await audit(trx, userId, "reminder_cancelled", id, correlation);
    return getReminder(trx, userId, id);
  });
}
export async function snoozeReminder(
  db: Kysely<Database>,
  userId: string,
  id: string,
  version: number,
  due: Date,
  correlation: string,
  now = new Date(),
) {
  if (due <= now)
    throw new DomainError(
      "VALIDATION_ERROR",
      422,
      "Choose a future snooze time.",
    );
  return inTransaction(db, async (trx) => {
    await sql`select id from users where id=${userId} for update`.execute(trx);
    const row = await getReminder(trx, userId, id, true);
    await editable(trx, row, version);
    await sql`update reminders set status='snoozed',next_attempt_at=${due},lease_token=null,lease_until=null,attention=false,reason='snoozed',version=version+1,updated_at=now() where user_id=${userId} and id=${id}`.execute(
      trx,
    );
    await audit(trx, userId, "reminder_snoozed", id, correlation);
    return getReminder(trx, userId, id);
  });
}
