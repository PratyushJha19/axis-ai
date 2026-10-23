import { Migrator, type Kysely } from "kysely";
import type { Database } from "../../packages/database/src/index.js";
import * as foundation from "../migrations/001-foundation.js";
import * as core from "../migrations/002-core.js";
import * as reminders from "../migrations/003-reminders.js";
import * as ai from "../migrations/004-ai.js";
import * as notifications from "../migrations/005-notifications.js";
import * as telegram from "../migrations/006-telegram.js";
import * as chatActions from "../migrations/007-chat-actions.js";
import * as reminderArchive from "../migrations/008-reminder-archive.js";

import * as approvals from "../migrations/009-approvals.js";

import * as agentRuns from "../migrations/010-agent-runs.js";
import * as planning from "../migrations/011-planning.js";
import * as calendar from "../migrations/012-calendar.js";
import * as telegramCommands from "../migrations/013-telegram-commands.js";
import * as workspaces from "../migrations/014-workspaces.js";

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
        "006-telegram": telegram,
        "007-chat-actions": chatActions,
        "008-reminder-archive": reminderArchive,
        "009-approvals": approvals,
        "010-agent-runs": agentRuns,
        "011-planning": planning,
        "012-calendar": calendar,
        "013-telegram-commands": telegramCommands,
        "014-workspaces": workspaces,
      }),
    },
  });
}
