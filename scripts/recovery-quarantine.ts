import { sql } from "kysely";
import { createDatabase } from "../packages/database/src/index.js";
import { readConfig } from "../packages/config/src/index.js";
const db = createDatabase(readConfig().DATABASE_URL);
try {
  await sql`update recovery_control set quarantined=true where id=1`.execute(
    db,
  );
  console.log(
    JSON.stringify({
      event: "recovery_quarantined",
      message:
        "API writes and workers are held. Reconcile external outcomes before operator release.",
    }),
  );
} catch {
  console.error(JSON.stringify({ event: "recovery_quarantine_failed" }));
  process.exitCode = 1;
} finally {
  await db.destroy();
}
