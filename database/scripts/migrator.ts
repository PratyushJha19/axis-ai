import { Migrator, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import * as foundation from "../migrations/001-foundation.js";
import * as core from "../migrations/002-core.js";
import * as reminders from "../migrations/003-reminders.js";
import * as ai from "../migrations/004-ai.js";
import * as notifications from "../migrations/005-notifications.js";

export function createMigrator(db: Kysely<Database>) {
  return new Migrator({
    db,
    provider: {
      getMigrations: async () => ({
        "001-foundation": foundation,
        "002-core": core,
        "003-reminders": reminders,
        "004-ai": ai,
        "005-notifications": notifications,
      }),
    },
  });
}
