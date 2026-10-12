import { sql } from "kysely";
import { readConfig } from "../../../packages/config/src/index.js";
import {
  createDatabase,
  checkDatabase,
} from "../../../packages/database/src/index.js";
import { messagingConfig } from "../../../packages/domain/src/notification-provider.js";
try {
  const db = createDatabase(readConfig().DATABASE_URL);
  try {
    await checkDatabase(db);
    const result = await sql<{
      healthy: boolean;
    }>`select coalesce(max(last_seen_at)>now()-interval '90 seconds',false) as healthy from worker_heartbeats`.execute(
      db,
    );
    const healthy = result.rows[0]?.healthy === true;
    console.log(
      JSON.stringify({
        status: healthy ? "ready" : "stale_or_stopped",
        mode: messagingConfig().mode === "live" ? "live" : "mock_only",
      }),
    );
    if (!healthy) process.exitCode = 1;
  } finally {
    await db.destroy();
  }
} catch {
  console.log(JSON.stringify({ status: "unavailable" }));
  process.exitCode = 1;
}
