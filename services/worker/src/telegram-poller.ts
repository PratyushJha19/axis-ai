import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/index.js";
import {
  responseJson,
  type MessagingConfig,
} from "../../../packages/domain/src/notification-provider.js";
import { receiveTelegramUpdate } from "../../../packages/domain/src/telegram.js";

export class TelegramPoller {
  constructor(
    readonly db: Kysely<Database>,
    readonly bot: NonNullable<MessagingConfig["telegram"]>,
    readonly fetcher: typeof fetch = fetch,
    readonly clock: () => Date = () => new Date(),
    readonly commands = false,
  ) {}
  async runOnce() {
    const now = this.clock(),
      token = randomUUID();
    await sql`insert into telegram_poll_state(bot_id) values (${this.bot.botId}) on conflict do nothing`.execute(
      this.db,
    );
    const claim = (
      await sql<{
        next_offset: string;
      }>`update telegram_poll_state set lease_token=${token},lease_until=${new Date(now.getTime() + 60000)} where bot_id=${this.bot.botId} and (lease_until is null or lease_until<=${now}) returning next_offset`.execute(
        this.db,
      )
    ).rows[0];
    if (!claim) return false;
    try {
      const response = await this.fetcher(
        `https://api.telegram.org/bot${this.bot.token}/getUpdates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          body: JSON.stringify({
            offset: Number(claim.next_offset),
            limit: 20,
            timeout: 0,
            allowed_updates: ["message"],
          }),
        },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Telegram polling unavailable");
      }
      const data = z
        .object({
          ok: z.literal(true),
          result: z
            .array(
              z
                .object({ update_id: z.number().int().nonnegative().safe() })
                .passthrough(),
            )
            .max(20),
        })
        .parse(await responseJson(response, 1048576));
      return await this.db.transaction().execute(async (trx) => {
        const current = (
          await sql<{
            lease_token: string;
            lease_until: string;
          }>`select lease_token,lease_until from telegram_poll_state where bot_id=${this.bot.botId} for update`.execute(
            trx,
          )
        ).rows[0]!;
        if (
          current.lease_token !== token ||
          new Date(current.lease_until) <= this.clock()
        )
          return false;
        let offset = Number(claim.next_offset);
        for (const update of data.result.sort(
          (a, b) => a.update_id - b.update_id,
        )) {
          if (update.update_id < offset) continue;
          await receiveTelegramUpdate(
            trx,
            this.bot.botId,
            update,
            this.clock(),
            this.commands,
          );
          offset = update.update_id + 1;
        }
        await sql`update telegram_poll_state set next_offset=${offset},lease_token=null,lease_until=null,last_success_at=${this.clock()} where bot_id=${this.bot.botId} and lease_token=${token}`.execute(
          trx,
        );
        return true;
      });
    } catch {
      // Back off failed polls; never log URLs because the Bot API token is in the path.
      await sql`update telegram_poll_state set lease_until=${new Date(this.clock().getTime() + 30000)} where bot_id=${this.bot.botId} and lease_token=${token}`.execute(
        this.db,
      );
      throw new Error("Telegram polling unavailable");
    }
  }
}
