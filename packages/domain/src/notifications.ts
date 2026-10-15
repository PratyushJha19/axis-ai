import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../database/src/index.js";
import {
  notificationSettingsSchema,
  phoneSchema,
  type NotificationSettings,
  type DeliveryJob,
  type Channel,
} from "../../shared/src/notifications.js";
import type { Reminder } from "../../shared/src/reminders.js";
import { DomainError } from "./errors.js";
import { audit } from "./records.js";
import { advanceStatus, type DeliveryResult } from "./notification-provider.js";

export type NotificationDB = Kysely<Database> | Transaction<Database>;
export const confirmed = (status: string) =>
  status === "delivered" || status === "read";
export const terminal = (status: string) =>
  confirmed(status) ||
  ["failed", "undelivered", "blocked", "suppressed"].includes(status);
export async function notificationSettings(db: NotificationDB, userId: string) {
  await sql`insert into notification_preferences(user_id,revision) values (${userId},${randomUUID()}) on conflict do nothing`.execute(
    db,
  );
  return (
    await sql<NotificationSettings>`select telegram_destination,telegram_bot_id,telegram_verified_at,telegram_enabled,whatsapp_destination,whatsapp_verified_at,whatsapp_window_until,whatsapp_enabled,email_destination,email_enabled,fallback_enabled,fallback_after_seconds,revision from notification_preferences where user_id=${userId}`.execute(
      db,
    )
  ).rows[0]!;
}
export async function rateWindow(
  db: NotificationDB,
  scope: string,
  limit: number,
  now: Date,
  durationMs: number,
) {
  const start = new Date(Math.floor(now.getTime() / durationMs) * durationMs);
  const result = await sql<{
    count: number;
  }>`insert into notification_rate_windows(scope,window_at,count) values (${scope},${start},1) on conflict(scope) do update set window_at=excluded.window_at,count=case when notification_rate_windows.window_at=excluded.window_at then notification_rate_windows.count+1 else 1 end returning count`.execute(
    db,
  );
  return result.rows[0]!.count <= limit;
}
export async function saveNotificationSettings(
  db: Kysely<Database>,
  userId: string,
  input: unknown,
  correlation: string,
) {
  const value = notificationSettingsSchema.parse(input);
  return db.transaction().execute(async (trx) => {
    const owner = (
      await sql<{
        email: string;
        email_verified_at: string | null;
      }>`select email,email_verified_at from users where id=${userId} for update`.execute(
        trx,
      )
    ).rows[0]!;
    const previous = await notificationSettings(trx, userId);
    if (value.revision !== previous.revision)
      throw new DomainError(
        "CONFLICT",
        409,
        "Settings changed. Refresh before saving.",
      );
    if (value.whatsapp_enabled && !previous.whatsapp_verified_at)
      throw new DomainError(
        "VERIFICATION_REQUIRED",
        422,
        "Link your WhatsApp number first.",
      );
    if (value.telegram_enabled && !previous.telegram_verified_at)
      throw new DomainError(
        "VERIFICATION_REQUIRED",
        422,
        "Link Telegram first.",
      );
    if (value.email_enabled && !owner.email_verified_at)
      throw new DomainError(
        "VERIFICATION_REQUIRED",
        422,
        "Sign out and sign in with Google again to verify your email.",
      );
    await sql`update notification_preferences set telegram_enabled=${value.telegram_enabled},whatsapp_enabled=${value.whatsapp_enabled},email_enabled=${value.email_enabled},email_destination=${value.email_enabled ? owner.email : null},fallback_enabled=${value.fallback_enabled},fallback_after_seconds=${value.fallback_after_seconds},revision=${randomUUID()},updated_at=now() where user_id=${userId}`.execute(
      trx,
    );
    await audit(trx, userId, "notification_consent_updated", null, correlation);
    return notificationSettings(trx, userId);
  });
}
export async function beginPhoneLink(
  db: Kysely<Database>,
  userId: string,
  phone: unknown,
  now = new Date(),
) {
  const destination = phoneSchema.parse(phone);
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${userId} for update`.execute(trx);
    if (!(await rateWindow(trx, `link:${userId}`, 5, now, 3600000)))
      throw new DomainError(
        "RATE_LIMITED",
        429,
        "Wait before requesting another linking code.",
      );
    const code = randomBytes(24).toString("hex");
    const expires = new Date(now.getTime() + 600000);
    await sql`insert into notification_links(user_id,destination,token_hash,expires_at) values (${userId},${destination},${createHash("sha256").update(code).digest("hex")},${expires}) on conflict(user_id) do update set destination=excluded.destination,token_hash=excluded.token_hash,expires_at=excluded.expires_at`.execute(
      trx,
    );
    return { code: `AXIS LINK ${code}`, expires_at: expires };
  });
}
export async function removePhone(
  db: Kysely<Database>,
  userId: string,
  correlation: string,
) {
  await db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${userId} for update`.execute(trx);
    await sql`delete from notification_links where user_id=${userId}`.execute(
      trx,
    );
    await sql`update notification_preferences set whatsapp_destination=null,whatsapp_verified_at=null,whatsapp_window_until=null,whatsapp_enabled=false,revision=${randomUUID()},updated_at=now() where user_id=${userId}`.execute(
      trx,
    );
    await audit(trx, userId, "notification_phone_removed", null, correlation);
  });
}
export async function receivePhoneMessage(
  db: Kysely<Database>,
  id: string,
  phone: string,
  body: string,
  now = new Date(),
) {
  await db.transaction().execute(async (trx) => {
    const link = /^AXIS LINK ([a-f0-9]{48})$/i.exec(body.trim());
    const owner = link
      ? (
          await sql<{
            user_id: string;
          }>`select user_id from notification_links where destination=${phone} and token_hash=${createHash("sha256").update(link[1]!.toLowerCase()).digest("hex")} and expires_at>${now}`.execute(
            trx,
          )
        ).rows[0]
      : (
          await sql<{
            user_id: string;
          }>`select user_id from notification_preferences where whatsapp_destination=${phone} and whatsapp_verified_at is not null`.execute(
            trx,
          )
        ).rows[0];
    if (!owner) return;
    await sql`select id from users where id=${owner.user_id} for update`.execute(
      trx,
    );
    if (
      !(
        await sql`insert into notification_events(provider,event_id) values ('twilio',${`inbound:${id}`}) on conflict do nothing returning event_id`.execute(
          trx,
        )
      ).rows.length
    )
      return;
    await notificationSettings(trx, owner.user_id);
    if (link) {
      const consumed =
        await sql`delete from notification_links where user_id=${owner.user_id} and destination=${phone} and token_hash=${createHash("sha256").update(link[1]!.toLowerCase()).digest("hex")} and expires_at>${now} returning user_id`.execute(
          trx,
        );
      if (!consumed.rows.length) return;
      const occupied =
        await sql`select user_id from notification_preferences where whatsapp_destination=${phone} and whatsapp_verified_at is not null and user_id<>${owner.user_id}`.execute(
          trx,
        );
      if (occupied.rows.length) return;
      await sql`update notification_preferences set whatsapp_destination=${phone},whatsapp_verified_at=${now},whatsapp_window_until=${new Date(now.getTime() + 86400000)},whatsapp_enabled=false,revision=${randomUUID()},updated_at=${now} where user_id=${owner.user_id}`.execute(
        trx,
      );
      await audit(
        trx,
        owner.user_id,
        "notification_phone_verified",
        null,
        randomUUID(),
      );
    } else if (/^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(body.trim())) {
      await sql`update notification_preferences set whatsapp_enabled=false,whatsapp_verified_at=null,whatsapp_window_until=null,revision=${randomUUID()},updated_at=${now} where user_id=${owner.user_id}`.execute(
        trx,
      );
      await audit(
        trx,
        owner.user_id,
        "notification_phone_opted_out",
        null,
        randomUUID(),
      );
    } else {
      // Only first receipt of a signed inbound event opens a service window.
      await sql`update notification_preferences set whatsapp_window_until=${new Date(now.getTime() + 86400000)} where user_id=${owner.user_id}`.execute(
        trx,
      );
    }
  });
}
export async function enqueueDelivery(
  db: NotificationDB,
  owner: string,
  key: string,
  channel: Channel,
  settings: NotificationSettings,
  now: Date,
  reminder?: Reminder,
  fallbackOf?: string,
) {
  const destination =
    channel === "telegram"
      ? settings.telegram_destination
      : channel === "whatsapp"
        ? settings.whatsapp_destination
        : settings.email_destination;
  const id = randomUUID();
  const enabled =
    channel === "telegram"
      ? settings.telegram_enabled && !!settings.telegram_verified_at
      : channel === "whatsapp"
        ? settings.whatsapp_enabled && !!settings.whatsapp_verified_at
        : settings.email_enabled && !!destination;
  const result =
    await sql<DeliveryJob>`insert into notification_jobs(id,user_id,reminder_id,occurrence,logical_key,channel,provider,kind,destination,preference_revision,status,fallback_of,next_attempt_at,attention,error_category,created_at,updated_at,telegram_bot_id)
    values (${id},${owner},${reminder?.id || null},${reminder?.occurrence || null},${key},${channel},${channel === "telegram" ? "telegram" : channel === "whatsapp" ? "twilio" : "resend"},${reminder ? "reminder" : "test"},${destination},${settings.revision},${enabled ? "queued" : "blocked"},${fallbackOf || null},${enabled ? now : null},${!enabled},${enabled ? null : "channel_not_configured"},${now},${now},${channel === "telegram" ? settings.telegram_bot_id : null}) on conflict(logical_key,channel) do nothing returning *`.execute(
      db,
    );
  return (
    result.rows[0] ||
    (
      await sql<DeliveryJob>`select * from notification_jobs where logical_key=${key} and channel=${channel}`.execute(
        db,
      )
    ).rows[0]!
  );
}
export async function enqueueReminder(
  db: Kysely<Database>,
  reminderId: string,
  owner: string,
  occurrence: number,
  key: string,
  now: Date,
  primaryChannel: "whatsapp" | "telegram" = "whatsapp",
) {
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${owner} for update`.execute(trx);
    const reminder = (
      await sql<Reminder>`select * from reminders where user_id=${owner} and id=${reminderId} for update`.execute(
        trx,
      )
    ).rows[0];
    if (
      !reminder ||
      reminder.occurrence !== occurrence ||
      reminder.status === "cancelled"
    )
      return;
    const settings = await notificationSettings(trx, owner);
    const primary = await enqueueDelivery(
      trx,
      owner,
      key,
      primaryChannel,
      settings,
      now,
      reminder,
    );
    if (
      !(primaryChannel === "telegram"
        ? settings.telegram_enabled
        : settings.whatsapp_enabled)
    )
      await sql`update notification_jobs set fallback_deadline_at=${now} where id=${primary.id}`.execute(
        trx,
      );
  });
}
export async function testNotification(
  db: Kysely<Database>,
  owner: string,
  channel: Channel,
  key: string,
  now = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${owner} for update`.execute(trx);
    const logical = `test:${owner}:${key}`;
    const existing = (
      await sql<DeliveryJob>`select * from notification_jobs where user_id=${owner} and logical_key=${logical}`.execute(
        trx,
      )
    ).rows[0];
    if (existing) {
      if (existing.channel !== channel)
        throw new DomainError(
          "CONFLICT",
          409,
          "This test request key was already used.",
        );
      return existing;
    }
    const settings = await notificationSettings(trx, owner);
    if (
      !(channel === "telegram"
        ? settings.telegram_enabled
        : channel === "whatsapp"
          ? settings.whatsapp_enabled
          : settings.email_enabled)
    )
      throw new DomainError(
        "VERIFICATION_REQUIRED",
        422,
        "Enable and confirm this saved channel first.",
      );
    if (!(await rateWindow(trx, `test:${owner}`, 3, now, 3600000)))
      throw new DomainError(
        "RATE_LIMITED",
        429,
        "Three channel tests per hour are allowed.",
      );
    const result = await enqueueDelivery(
      trx,
      owner,
      logical,
      channel,
      settings,
      now,
    );
    await audit(
      trx,
      owner,
      "notification_test_requested",
      result.id,
      randomUUID(),
    );
    return result;
  });
}
export async function wakeReminder(
  db: NotificationDB,
  job: DeliveryJob,
  now: Date,
) {
  if (job.reminder_id)
    await sql`update reminders set next_attempt_at=${now},reconcile_count=0,attention=false where id=${job.reminder_id} and user_id=${job.user_id} and occurrence=${job.occurrence} and status in ('sent','unknown')`.execute(
      db,
    );
}
export async function applyDeliveryResult(
  db: NotificationDB,
  job: DeliveryJob,
  result: DeliveryResult,
  now: Date,
) {
  const status = advanceStatus(job.status, result.status);
  const changed =
    status !== job.status || (!job.provider_message_id && result.messageId);
  await sql`update notification_jobs set status=${status},provider_message_id=coalesce(provider_message_id,${result.messageId || null}),updated_at=${now},accepted_at=case when ${["accepted", "sent", "delivered", "read"].includes(status)} then coalesce(accepted_at,${now}) else accepted_at end,delivered_at=case when ${confirmed(status)} then coalesce(delivered_at,${now}) else delivered_at end,error_category=${confirmed(status) ? null : result.category || job.error_category || (status === "failed" || status === "undelivered" ? "permanent" : null)},attention=${(terminal(status) || job.attention) && !confirmed(status)},next_attempt_at=case when ${terminal(status)} then null else next_attempt_at end where id=${job.id}`.execute(
    db,
  );
  if (changed) await wakeReminder(db, job, now);
  return status;
}
export async function deliveryWebhook(
  db: Kysely<Database>,
  provider: "twilio" | "resend" | "telegram",
  eventId: string,
  messageId: string,
  result: DeliveryResult,
  binding: { jobId?: string; destination?: string },
  now = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    const candidate = (
      await sql<DeliveryJob>`select * from notification_jobs where provider=${provider} and ${binding.jobId ? sql`id=${binding.jobId}` : sql`provider_message_id=${messageId}`}`.execute(
        trx,
      )
    ).rows[0];
    if (!candidate) return false;
    await sql`select id from users where id=${candidate.user_id} for update`.execute(
      trx,
    );
    const job = (
      await sql<DeliveryJob>`select * from notification_jobs where id=${candidate.id} for update`.execute(
        trx,
      )
    ).rows[0];
    if (
      !job ||
      !job.attempt_count ||
      (job.provider_message_id && job.provider_message_id !== messageId) ||
      (binding.destination && job.destination !== binding.destination)
    )
      return false;
    if (
      !(
        await sql`insert into notification_events(provider,event_id) values (${provider},${eventId}) on conflict do nothing returning event_id`.execute(
          trx,
        )
      ).rows.length
    )
      return true;
    await applyDeliveryResult(trx, job, { ...result, messageId }, now);
    const attempt = (
      await sql<{
        id: string;
        status: DeliveryJob["status"];
      }>`select id,status from notification_attempts where job_id=${job.id} order by attempt_number desc limit 1 for update`.execute(
        trx,
      )
    ).rows[0];
    if (attempt)
      await sql`update notification_attempts set status=${advanceStatus(attempt.status, result.status)},provider_message_id=coalesce(provider_message_id,${messageId}),finished_at=${now} where id=${attempt.id}`.execute(
        trx,
      );
    await audit(
      trx,
      job.user_id,
      "notification_status_received",
      job.id,
      randomUUID(),
    );
    return true;
  });
}
