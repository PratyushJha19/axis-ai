import { readConfig } from "../../packages/config/src/index.js";
import { createDatabase } from "../../packages/database/src/index.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { createMigrator } from "./migrator.js";

const logger = createLogger();
try {
  const db = createDatabase(readConfig().DATABASE_URL);
  try {
    const result = await createMigrator(db).migrateToLatest();
    if (result.error) throw new Error("Migration failed");
    logger.info({
      event: "migration_succeeded",
      count: result.results?.length ?? 0,
    });
  } finally {
    await db.destroy();
  }
} catch {
  logger.error({ event: "migration_failed" });
  process.exitCode = 1;
}
