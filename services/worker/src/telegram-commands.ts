import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/index.js";
import { checkDatabase } from "../../../packages/database/src/index.js";
import { AIService } from "../../../packages/domain/src/ai.js";
import {
  chatActionInstructions,
  parseChatReply,
} from "../../../packages/domain/src/chat-actions.js";
import { DomainError } from "../../../packages/domain/src/errors.js";
import {
  commandReply,
  processTelegramCommand,
  telegramIdentity,
  type TelegramCommand,
} from "../../../packages/domain/src/telegram-commands.js";
import {
  responseJson,
  type MessagingConfig,
} from "../../../packages/domain/src/notification-provider.js";

export class TelegramCommandWorker {
  constructor(
    readonly db: Kysely<Database>,
    readonly bot: NonNullable<MessagingConfig["telegram"]>,
    readonly ai: Pick<AIService, "agentCompletion">,
    readonly fetcher: typeof fetch = fetch,
  ) {}

  async runOnce() {
    await checkDatabase(this.db);
    // An interrupted provider call is never repeated automatically.
    await sql`update telegram_commands set status='unknown',input='',lease_until=null where bot_id=${this.bot.botId} and status='processing' and lease_until<=now()`.execute(
      this.db,
    );
    await sql`update telegram_command_replies set status='unknown',lease_until=null where bot_id=${this.bot.botId} and status='sending' and lease_until<=now()`.execute(
      this.db,
    );
    await sql`update telegram_commands set status='suppressed',input='' where bot_id=${this.bot.botId} and status='queued' and created_at<now()-interval '24 hours'`.execute(
      this.db,
    );
    const c = (
      await sql<TelegramCommand>`update telegram_commands set status='processing',lease_until=now()+interval '90 seconds' where id=(select id from telegram_commands where bot_id=${this.bot.botId} and status='queued' order by created_at,id for update skip locked limit 1) returning *`.execute(
        this.db,
      )
    ).rows[0];
    if (c) {
      let interpreted: ReturnType<typeof parseChatReply> | undefined;
      let failure: string | undefined;
      if (await telegramIdentity(this.db, c)) {
        if (!c.input.trim().startsWith("/")) {
          try {
            const profile = (
              await sql<{
                timezone: string | null;
              }>`select timezone from users where id=${c.user_id}`.execute(
                this.db,
              )
            ).rows[0];
            const answer = await this.ai.agentCompletion(c.user_id, [
              {
                role: "system",
                content: chatActionInstructions(profile?.timezone ?? null),
              },
              { role: "user", content: c.input },
            ]);
            interpreted = parseChatReply(
              answer.content,
              profile?.timezone ?? null,
            );
            if (!interpreted.payload)
              interpreted.reply = `AI response (no action performed):\n${interpreted.reply}`;
          } catch {
            failure =
              "AI interpretation was unavailable or uncertain. No action was performed and no automatic retry was made. Check AI Settings or use /help for commands that do not need AI.";
          }
        }
      }
      await this.db.transaction().execute(async (trx) => {
        await sql`select id from users where id=${c.user_id} for update`.execute(
          trx,
        );
        const current = (
          await sql`select id from telegram_commands where id=${c.id} and status='processing' and lease_until>now() for update`.execute(
            trx,
          )
        ).rows[0];
        if (!current) return;
        if (!(await telegramIdentity(trx, c))) {
          await sql`update telegram_commands set status='suppressed',input='',lease_until=null where id=${c.id}`.execute(
            trx,
          );
          return;
        }
        await sql`savepoint telegram_effect`.execute(trx);
        try {
          const result = failure
            ? { body: failure }
            : await processTelegramCommand(trx, c, interpreted);
          await commandReply(
            trx,
            c,
            result.body,
            "proposal" in result ? result.proposal : undefined,
          );
        } catch (error) {
          // A bad command must not poison subsequent commands or the webhook queue.
          if (!(error instanceof DomainError))
            await sql`rollback to savepoint telegram_effect`.execute(trx);
          const text =
            error instanceof DomainError
              ? error.message
              : "Invalid command or action unavailable. Nothing changed. Use /help and copy the full ID from /tasks or /reminders.";
          await commandReply(trx, c, text);
        }
      });
    }
    await this.sendReply();
    // Command text is cleared immediately after processing; reply content lasts seven days.
    await sql`delete from telegram_commands where id in (select id from telegram_commands where created_at<now()-interval '7 days' and status in ('done','unknown','suppressed') order by created_at limit 100)`.execute(
      this.db,
    );
    return Boolean(c);
  }

  async sendReply() {
    const candidate = (
      await sql<
        TelegramCommand & { body: string }
      >`select * from telegram_command_replies where bot_id=${this.bot.botId} and status='queued' order by created_at,id limit 1`.execute(
        this.db,
      )
    ).rows[0];
    if (!candidate) return;
    const claimed = await this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${candidate.user_id} for update`.execute(
        trx,
      );
      if (!(await telegramIdentity(trx, candidate))) {
        await sql`update telegram_command_replies set status='suppressed' where id=${candidate.id} and status='queued'`.execute(
          trx,
        );
        return false;
      }
      return !!(
        await sql`update telegram_command_replies set status='sending',lease_until=now()+interval '60 seconds' where id=${candidate.id} and status='queued' returning id`.execute(
          trx,
        )
      ).rows.length;
    });
    if (!claimed) return;
    let status = "unknown";
    try {
      const response = await this.fetcher(
        `https://api.telegram.org/bot${this.bot.token}/sendMessage`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: candidate.destination,
            text: candidate.body,
            allow_paid_broadcast: false,
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const data = await responseJson(response);
      const receipt = z
        .object({
          ok: z.literal(true),
          result: z.object({
            message_id: z.number().int().positive().safe(),
            chat: z.object({ id: z.number().int().positive().safe() }),
          }),
        })
        .safeParse(data);
      if (
        response.ok &&
        receipt.success &&
        String(receipt.data.result.chat.id) === candidate.destination
      )
        status = "sent";
      else if (data.ok === false && typeof data.error_code === "number")
        status = "failed";
    } catch {
      /* no provider URLs, credentials or message bodies in logs */
    }
    await sql`update telegram_command_replies set status=${status},lease_until=null where id=${candidate.id} and status='sending'`.execute(
      this.db,
    );
  }
}
