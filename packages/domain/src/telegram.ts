import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../database/src/index.js";
import {
  notificationSettings,
  rateWindow,
  type NotificationDB,
} from "./notifications.js";
import { DomainError } from "./errors.js";
import { audit } from "./records.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function beginTelegramLink(
  db: Kysely<Database>,
  user: string,
  botId: string,
  now = new Date(),
) {
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${user} for update`.execute(trx);
    if (!(await rateWindow(trx, `telegram-link:${user}`, 5, now, 3600000)))
      throw new DomainError(
        "RATE_LIMITED",
        429,
        "Wait before requesting another linking code.",
      );
    const token = randomBytes(24).toString("hex");
    const expires = new Date(now.getTime() + 600000);
    await sql`insert into telegram_links(user_id,bot_id,token_hash,expires_at) values (${user},${botId},${hash(token)},${expires}) on conflict(user_id) do update set bot_id=excluded.bot_id,token_hash=excluded.token_hash,expires_at=excluded.expires_at`.execute(
      trx,
    );
    return { code: `/start ${token}`, expires_at: expires };
  });
}
export async function removeTelegram(
  db: Kysely<Database>,
  user: string,
  correlation: string,
) {
  await db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${user} for update`.execute(trx);
    await sql`delete from telegram_links where user_id=${user}`.execute(trx);
    await sql`update notification_preferences set telegram_destination=null,telegram_bot_id=null,telegram_verified_at=null,telegram_enabled=false,revision=${randomUUID()},updated_at=now() where user_id=${user}`.execute(
      trx,
    );
    await audit(trx, user, "telegram_removed", null, correlation);
  });
}
const positiveId = z.number().int().positive().safe();
const messageSchema = z.object({
  from: z.object({ id: positiveId, is_bot: z.literal(false) }),
  chat: z.object({ id: positiveId, type: z.literal("private") }),
  text: z.string().max(4096),
});
// Called only inside the fenced polling transaction; never exposed as a public webhook.
export async function receiveTelegramUpdate(
  db: NotificationDB,
  botId: string,
  update: unknown,
  now: Date,
) {
  const envelope = z
    .object({
      update_id: z.number().int().nonnegative().safe(),
      message: z.unknown().optional(),
    })
    .safeParse(update);
  if (!envelope.success) return;
  const parsed = messageSchema.safeParse(envelope.data.message);
  if (!parsed.success || parsed.data.from.id !== parsed.data.chat.id) return;
  const message = parsed.data,
    destination = String(message.chat.id);
  const link = /^\/start ([a-f0-9]{48})$/.exec(message.text.trim());
  const stop = /^(\/stop|stop)$/i.test(message.text.trim());
  if (!link && !stop) return;
  const owner = (
    await (
      link
        ? sql<{
            user_id: string;
          }>`select user_id from telegram_links where bot_id=${botId} and token_hash=${hash(link[1]!)} and expires_at>${now}`
        : sql<{
            user_id: string;
          }>`select user_id from notification_preferences where telegram_bot_id=${botId} and telegram_destination=${destination} and telegram_verified_at is not null`
    ).execute(db)
  ).rows[0];
  if (!owner) return;
  await sql`select id from users where id=${owner.user_id} for update`.execute(
    db,
  );
  if (
    !(
      await sql`insert into notification_events(provider,event_id) values ('telegram',${`${botId}:${envelope.data.update_id}`}) on conflict do nothing returning event_id`.execute(
        db,
      )
    ).rows.length
  )
    return;
  await notificationSettings(db, owner.user_id);
  if (link) {
    if (
      !(
        await sql`delete from telegram_links where user_id=${owner.user_id} and bot_id=${botId} and token_hash=${hash(link[1]!)} and expires_at>${now} returning user_id`.execute(
          db,
        )
      ).rows.length
    )
      return;
    // Serialize claims for the same Telegram identity, including different AXIS owners.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`telegram:${botId}:${destination}`},0))`.execute(
      db,
    );
    if (
      (
        await sql`select user_id from notification_preferences where telegram_bot_id=${botId} and telegram_destination=${destination} and telegram_verified_at is not null and user_id<>${owner.user_id}`.execute(
          db,
        )
      ).rows.length
    )
      return;
    await sql`update notification_preferences set telegram_destination=${destination},telegram_bot_id=${botId},telegram_verified_at=${now},telegram_enabled=false,revision=${randomUUID()},updated_at=${now} where user_id=${owner.user_id}`.execute(
      db,
    );
  } else {
    await sql`delete from telegram_links where user_id=${owner.user_id}`.execute(
      db,
    );
    await sql`update notification_preferences set telegram_enabled=false,telegram_verified_at=null,revision=${randomUUID()},updated_at=${now} where user_id=${owner.user_id}`.execute(
      db,
    );
  }
  await audit(
    db,
    owner.user_id,
    link ? "telegram_linked" : "telegram_opted_out",
    null,
    randomUUID(),
  );
}
