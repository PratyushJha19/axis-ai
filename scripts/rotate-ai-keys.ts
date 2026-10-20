import { sql } from "kysely";
import { readConfig } from "../packages/config/src/index.js";
import { readAIConfig } from "../packages/domain/src/ai-crypto.js";
import { createDatabase } from "../packages/database/src/index.js";
import { createLogger } from "../packages/observability/src/index.js";

// Offline maintenance: stop the API first; worker can continue. Never prints keys.
const logger = createLogger();
try {
  const ai = readAIConfig();
  if (!ai) throw new Error();
  const db = createDatabase(readConfig().DATABASE_URL);
  try {
    const count = await db.transaction().execute(async (trx) => {
      const rows = (
        await sql<{
          user_id: string;
          provider: string;
          encrypted_key: unknown;
        }>`select user_id,provider,encrypted_key from ai_configs for update`.execute(
          trx,
        )
      ).rows;
      for (const row of rows) {
        const secret = ai.vault.decrypt(
          row.encrypted_key,
          row.user_id,
          row.provider,
        );
        await sql`update ai_configs set encrypted_key=${JSON.stringify(ai.vault.encrypt(secret, row.user_id, row.provider))}::jsonb where user_id=${row.user_id}`.execute(
          trx,
        );
      }
      const calendar = (
        await sql<{
          user_id: string;
          credential: unknown;
        }>`select user_id,credential from calendar_connections where credential is not null for update`.execute(
          trx,
        )
      ).rows;
      for (const row of calendar) {
        const secret = ai.vault.decrypt(
          row.credential,
          row.user_id,
          "google-calendar",
        );
        await sql`update calendar_connections set credential=${JSON.stringify(ai.vault.encrypt(secret, row.user_id, "google-calendar"))}::jsonb where user_id=${row.user_id}`.execute(
          trx,
        );
      }
      // Pending consent challenges expire; require a fresh flow after rotation.
      await sql`delete from calendar_challenges`.execute(trx);
      return rows.length + calendar.length;
    });
    logger.info({ event: "ai_key_rotation_succeeded", count });
  } finally {
    await db.destroy();
  }
} catch {
  logger.error({
    event: "ai_key_rotation_failed",
    reason:
      "Check encryption key versions and database configuration. No credentials were printed.",
  });
  process.exitCode = 1;
}
