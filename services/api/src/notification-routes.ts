import express, { Router } from "express";
import { z } from "zod";
import { sql, type Kysely } from "kysely";
import { validateRequest } from "twilio/lib/webhooks/webhooks.js";
import { Webhook } from "svix";
import { rateLimit } from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { checkDatabase } from "../../../packages/database/src/index.js";
import type { Database } from "../../../packages/database/src/index.js";
import {
  notificationSettings,
  saveNotificationSettings,
  removePhone,
  receivePhoneMessage,
  testNotification,
  deliveryWebhook,
} from "../../../packages/domain/src/notifications.js";
import {
  twilioStatus,
  emailStatus,
  type MessagingConfig,
} from "../../../packages/domain/src/notification-provider.js";
import { reminderListSchema } from "../../../packages/shared/src/reminders.js";
import { DomainError } from "../../../packages/domain/src/errors.js";
import {
  beginTelegramLink,
  removeTelegram,
  receiveTelegramUpdate,
} from "../../../packages/domain/src/telegram.js";

export function notificationRouter(
  db: Kysely<Database>,
  config: MessagingConfig,
) {
  const router = Router();
  router.get("/notification-settings", async (_req, res) => {
    const owner = res.locals.user.id as string;
    const user = (
      await sql<{
        email: string;
        email_verified_at: string | null;
      }>`select email,email_verified_at from users where id=${owner}`.execute(
        db,
      )
    ).rows[0]!;
    res.json({
      settings: await notificationSettings(db, owner),
      email: user.email,
      email_verified: !!user.email_verified_at,
      mode: config.mode,
      sandbox: config.sandbox,
      whatsapp_configured: !!config.twilio && !!config.publicOrigin,
      email_configured: !!config.email && !!config.publicOrigin,
      whatsapp_from: config.twilio?.from || null,
      telegram_configured: !!config.telegram,
      telegram_username: config.telegram?.username || null,
      telegram_transport: config.telegramWebhookSecret ? "webhook" : "polling",
      telegram_commands_enabled: Boolean(config.telegramCommands),
      telegram_poll_healthy: config.telegram
        ? (
            await sql<{
              healthy: boolean;
            }>`select coalesce(max(last_success_at)>now()-interval '90 seconds',false) as healthy from telegram_poll_state where bot_id=${config.telegram.botId}`.execute(
              db,
            )
          ).rows[0]!.healthy
        : false,
    });
  });
  router.put("/notification-settings", async (req, res) => {
    if (
      req.body?.telegram_enabled === true &&
      (!config.telegram ||
        (await notificationSettings(db, res.locals.user.id)).telegram_bot_id !==
          config.telegram.botId)
    )
      throw new DomainError(
        "VERIFICATION_REQUIRED",
        422,
        "Link the configured Telegram bot before enabling.",
      );
    if (req.body?.whatsapp_enabled === true)
      throw new DomainError(
        "CHANNEL_RETIRED",
        422,
        "WhatsApp has been replaced by Telegram. Link Telegram and save new consent.",
      );
    res.json(
      await saveNotificationSettings(
        db,
        res.locals.user.id,
        req.body,
        res.locals.requestId,
      ),
    );
  });
  router.post("/notification-settings/telegram/link", async (req, res) => {
    z.object({}).strict().parse(req.body);
    if (config.mode !== "live" || !config.telegram)
      throw new DomainError(
        "CONFIGURATION_REQUIRED",
        422,
        "Configure the Telegram bot before linking.",
      );
    res.json(
      await beginTelegramLink(db, res.locals.user.id, config.telegram.botId),
    );
  });
  router.delete("/notification-settings/telegram", async (_req, res) => {
    await removeTelegram(db, res.locals.user.id, res.locals.requestId);
    res.status(204).end();
  });
  router.post("/notification-settings/whatsapp/link", () => {
    throw new DomainError(
      "CHANNEL_RETIRED",
      410,
      "WhatsApp has been replaced by Telegram.",
    );
  });
  router.delete("/notification-settings/whatsapp", async (_req, res) => {
    await removePhone(db, res.locals.user.id, res.locals.requestId);
    res.status(204).end();
  });
  router.post("/notifications/test", async (req, res) => {
    const body = z
      .object({
        channel: z.enum(["telegram", "email"]),
        consent: z.literal(true),
      })
      .strict()
      .parse(req.body);
    if (config.mode !== "live")
      throw new DomainError(
        "CONFIGURATION_REQUIRED",
        422,
        "Live delivery is disabled. No message was queued.",
      );
    if (
      !(body.channel === "telegram"
        ? config.telegram
        : config.email && config.publicOrigin)
    )
      throw new DomainError(
        "CONFIGURATION_REQUIRED",
        422,
        "Configure this notification provider before testing. No message was queued.",
      );
    const job = await testNotification(
      db,
      res.locals.user.id,
      body.channel,
      z.uuid().parse(req.get("idempotency-key")),
    );
    res.status(202).json({ id: job.id, status: job.status });
  });
  router.get("/notifications", async (req, res) => {
    const page = reminderListSchema.parse(req.query);
    const rows = (
      await sql`select id,reminder_id,occurrence,channel,provider,kind,status,fallback_of,fallback_deadline_at,next_attempt_at,attempt_count,reconcile_count,error_category,attention,created_at,updated_at,accepted_at,delivered_at,(select title from reminders r where r.user_id=notification_jobs.user_id and r.id=notification_jobs.reminder_id) as title from notification_jobs where user_id=${res.locals.user.id} order by created_at desc,id desc limit ${page.limit + 1} offset ${page.offset}`.execute(
        db,
      )
    ).rows;
    res.json({
      items: rows.slice(0, page.limit),
      hasMore: rows.length > page.limit,
    });
  });
  router.get("/notifications/:id", async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const job = (
      await sql`select id,reminder_id,occurrence,channel,provider,kind,status,fallback_of,fallback_deadline_at,next_attempt_at,attempt_count,reconcile_count,error_category,attention,created_at,updated_at,accepted_at,delivered_at from notification_jobs where user_id=${res.locals.user.id} and id=${id}`.execute(
        db,
      )
    ).rows[0];
    if (!job)
      throw new DomainError("NOT_FOUND", 404, "Notification not found.");
    const attempts = (
      await sql`select id,channel,provider,status,attempt_number,error_category,started_at,finished_at from notification_attempts where user_id=${res.locals.user.id} and job_id=${id} order by attempt_number`.execute(
        db,
      )
    ).rows;
    res.json({ job, attempts });
  });
  router.post("/notifications/:id/reconcile", async (req, res) => {
    z.object({}).strict().parse(req.body);
    const id = z.uuid().parse(req.params.id);
    const result =
      await sql`update notification_jobs set reconcile_count=0,next_attempt_at=now(),attention=false where user_id=${res.locals.user.id} and id=${id} and channel<>'telegram' and attention and status in ('accepted','sent','unknown') and provider_message_id is not null and lease_token is null returning id`.execute(
        db,
      );
    if (!result.rows.length)
      throw new DomainError(
        "CONFLICT",
        409,
        "Only unresolved deliveries with a provider reference can be reconciled. No resend is performed.",
      );
    res.status(202).json({ status: "reconciliation_queued" });
  });
  return router;
}
export function notificationWebhooks(
  db: Kysely<Database>,
  config: MessagingConfig,
) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 1000,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  router.post(
    "/telegram",
    express.json({ limit: "32kb" }),
    async (req, res) => {
      const expected = config.telegramWebhookSecret;
      const actual = req.get("x-telegram-bot-api-secret-token") || "";
      if (
        config.mode !== "live" ||
        !config.telegram ||
        !expected ||
        Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
      )
        throw new DomainError(
          "INVALID_SIGNATURE",
          403,
          "Invalid webhook authentication.",
        );
      try {
        await checkDatabase(db);
      } catch {
        throw new DomainError(
          "DEPENDENCY_UNAVAILABLE",
          503,
          "Service is not ready.",
        );
      }
      const update = z
        .object({ update_id: z.number().int().nonnegative().safe() })
        .passthrough()
        .parse(req.body);
      await db.transaction().execute(async (trx) => {
        await receiveTelegramUpdate(
          trx,
          config.telegram!.botId,
          update,
          new Date(),
          Boolean(config.telegramCommands),
        );
        await sql`insert into telegram_poll_state(bot_id,last_success_at) values (${config.telegram!.botId},now()) on conflict(bot_id) do update set last_success_at=now()`.execute(
          trx,
        );
      });
      res.json({ ok: true });
    },
  );
  const form = express.urlencoded({
    extended: false,
    limit: "16kb",
    parameterLimit: 100,
  });
  function verifyTwilio(req: express.Request, path: string) {
    const params = z.record(z.string(), z.string().max(8000)).parse(req.body);
    if (
      config.mode !== "live" ||
      !config.twilio ||
      !config.publicOrigin ||
      params.AccountSid !== config.twilio.account ||
      !validateRequest(
        config.twilio.token,
        req.get("x-twilio-signature") || "",
        `${config.publicOrigin}${path}`,
        params,
      )
    )
      throw new DomainError(
        "INVALID_SIGNATURE",
        403,
        "Webhook verification failed.",
      );
    return params;
  }
  router.post("/twilio/status/:id", form, async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const body = verifyTwilio(req, `/webhooks/twilio/status/${id}`);
    const messageId = z
      .string()
      .regex(/^SM[0-9a-f]{32}$/i)
      .parse(body.MessageSid);
    if (body.From !== config.twilio!.from)
      throw new DomainError(
        "INVALID_SIGNATURE",
        403,
        "Webhook account binding failed.",
      );
    const destination = z
      .string()
      .regex(/^whatsapp:\+[1-9]\d{7,14}$/)
      .parse(body.To)
      .slice(9);
    const status = twilioStatus(body.MessageStatus);
    await deliveryWebhook(
      db,
      "twilio",
      `${messageId}:${status}`,
      messageId,
      { status },
      { jobId: id, destination },
    );
    res.status(204).end();
  });
  router.post("/twilio/inbound", form, async (req, res) => {
    const body = verifyTwilio(req, "/webhooks/twilio/inbound");
    if (body.To !== config.twilio!.from)
      throw new DomainError(
        "INVALID_SIGNATURE",
        403,
        "Webhook account binding failed.",
      );
    const from = z
      .string()
      .regex(/^whatsapp:\+[1-9]\d{7,14}$/)
      .parse(body.From)
      .slice(9);
    await receivePhoneMessage(
      db,
      z
        .string()
        .regex(/^SM[0-9a-f]{32}$/i)
        .parse(body.MessageSid),
      from,
      z.string().max(4000).parse(body.Body),
    );
    // No automatic reply or arbitrary chat/action handling in M3.
    res.type("text/xml").send("<Response></Response>");
  });
  router.post(
    "/resend",
    express.raw({ type: "application/json", limit: "32kb" }),
    async (req, res) => {
      if (config.mode !== "live" || !config.email || !Buffer.isBuffer(req.body))
        throw new DomainError(
          "INVALID_SIGNATURE",
          403,
          "Webhook verification failed.",
        );
      let value: unknown;
      const eventId = req.get("svix-id") || "";
      try {
        new Webhook(config.email.webhookSecret).verify(
          req.body.toString("utf8"),
          {
            "svix-id": eventId,
            "svix-timestamp": req.get("svix-timestamp") || "",
            "svix-signature": req.get("svix-signature") || "",
          },
        );
        value = JSON.parse(req.body.toString("utf8"));
      } catch {
        throw new DomainError(
          "INVALID_SIGNATURE",
          403,
          "Webhook verification failed.",
        );
      }
      const event = z
        .object({
          type: z.string(),
          data: z.object({
            email_id: z.uuid(),
            to: z.array(z.email()).max(10),
            tags: z.record(z.string(), z.string()).optional(),
          }),
        })
        .parse(value);
      const supported = [
        "email.sent",
        "email.delivered",
        "email.delivery_delayed",
        "email.bounced",
        "email.failed",
        "email.complained",
        "email.suppressed",
      ];
      if (supported.includes(event.type) && event.data.to.length === 1) {
        const jobId = z.uuid().safeParse(event.data.tags?.axis_job);
        await deliveryWebhook(
          db,
          "resend",
          z.string().max(200).parse(eventId),
          event.data.email_id,
          { status: emailStatus(event.type.slice(6)) },
          {
            jobId: jobId.success ? jobId.data : undefined,
            destination: event.data.to[0],
          },
        );
      }
      res.status(204).end();
    },
  );
  return router;
}
