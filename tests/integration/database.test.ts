import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { sql } from "kysely";
import request from "supertest";
import {
  createDatabase,
  checkDatabase,
} from "../../packages/database/src/index.js";
import { createMigrator } from "../../database/scripts/migrator.js";
import { createApp } from "../../services/api/src/app.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { coreScenarios } from "./core-scenarios.js";
import { reminderScenarios } from "./reminder-scenarios.js";
import { aiScenarios } from "./ai-scenarios.js";
import { multiUserScenarios } from "./multi-user-scenarios.js";
import { notificationScenarios } from "./notification-scenarios.js";
import { telegramScenarios } from "./telegram-scenarios.js";
import { agentScenarios } from "./agent-scenarios.js";
import { approvalScenarios } from "./approval-scenarios.js";
import { chatActionScenarios } from "./chat-action-scenarios.js";
import { reminderRetentionScenarios } from "./reminder-retention-scenarios.js";
import { planningScenarios } from "./planning-scenarios.js";

test("empty PostgreSQL migrates, repeats safely, and persists across connection restart", async (t) => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(
    connectionString,
    "TEST_DATABASE_URL is required; this test must not silently skip.",
  );
  const url = new URL(connectionString);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname),
    "Use an isolated local database.",
  );
  assert.match(
    url.pathname,
    /^\/axis_test_[a-z0-9_]+$/,
    "Use a dedicated axis_test_ database.",
  );
  const db = createDatabase(connectionString);
  try {
    const existing = await sql<{
      name: string | null;
    }>`select to_regclass('foundation_metadata')::text as name`.execute(db);
    assert.equal(
      existing.rows[0]?.name,
      null,
      "Test requires an empty database; create a new one.",
    );
    const app = createApp({
      checkReady: () => checkDatabase(db),
      logger: createLogger("silent"),
    });
    await request(app).get("/health/ready").expect(503);
    const m1 = await createMigrator(db).migrateTo("002-core");
    assert.equal(m1.error, undefined);
    assert.equal(m1.results?.length, 2);
    const upgradeUser = randomUUID(),
      upgradeTask = randomUUID();
    await sql`insert into users(id,google_subject,email,display_name) values (${upgradeUser},'upgrade-fixture','upgrade@example.invalid','Upgrade fixture')`.execute(
      db,
    );
    await sql`insert into tasks(id,user_id,title) values (${upgradeTask},${upgradeUser},'M1 upgrade fixture')`.execute(
      db,
    );
    const m2 = await createMigrator(db).migrateTo("003-reminders");
    assert.equal(m2.error, undefined);
    assert.equal(m2.results?.length, 1);
    const m3 = await createMigrator(db).migrateTo("005-notifications");
    assert.equal(m3.error, undefined);
    const legacyJob = randomUUID(),
      legacyRevision = randomUUID();
    await sql`insert into notification_preferences(user_id,whatsapp_destination,whatsapp_verified_at,whatsapp_enabled,revision) values (${upgradeUser},'+15005550006',now(),true,${legacyRevision})`.execute(
      db,
    );
    await sql`insert into notification_jobs(id,user_id,logical_key,channel,provider,kind,destination,preference_revision,next_attempt_at) values (${legacyJob},${upgradeUser},${`upgrade:${legacyJob}`},'whatsapp','twilio','test','+15005550006',${legacyRevision},now())`.execute(
      db,
    );
    const beforeM4 = await createMigrator(db).migrateTo("008-reminder-archive");
    assert.equal(beforeM4.error, undefined);
    const legacyProposal = randomUUID();
    await sql`insert into ai_conversations(id,user_id,title) values(${legacyProposal},${upgradeUser},'Legacy proposal')`.execute(
      db,
    );
    await sql`insert into ai_requests(id,user_id,conversation_id,payload_hash,status,include_context,expires_at) values(${legacyProposal},${upgradeUser},${legacyProposal},'legacy','succeeded',false,now())`.execute(
      db,
    );
    await sql`insert into ai_action_proposals(id,user_id,conversation_id,request_id,payload,payload_hash,status,entity_id) values(${legacyProposal},${upgradeUser},${legacyProposal},${legacyProposal},'{"kind":"task","title":"Historical"}'::jsonb,'legacy','succeeded',${upgradeTask})`.execute(
      db,
    );
    const first = await createMigrator(db).migrateToLatest();
    assert.equal(first.error, undefined);
    assert.equal(first.results?.length, 3);
    const migrated = (
      await sql<{
        status: string;
        entity_id: string;
        integrity: boolean;
      }>`select status,entity_id,context_hash=approval_digest(user_id,id,payload,policy_version) as integrity from ai_action_proposals where id=${legacyProposal}`.execute(
        db,
      )
    ).rows[0]!;
    assert.deepEqual(migrated, {
      status: "succeeded",
      entity_id: upgradeTask,
      integrity: true,
    });
    const legacy = (
      await sql<{
        status: string;
        next_attempt_at: string | null;
      }>`select status,next_attempt_at from notification_jobs where id=${legacyJob}`.execute(
        db,
      )
    ).rows[0]!;
    assert.equal(legacy.status, "blocked");
    assert.equal(legacy.next_attempt_at, null);
    const preferences = (
      await sql<{
        whatsapp_enabled: boolean;
        telegram_enabled: boolean;
        fallback_enabled: boolean;
      }>`select whatsapp_enabled,telegram_enabled,fallback_enabled from notification_preferences where user_id=${upgradeUser}`.execute(
        db,
      )
    ).rows[0]!;
    assert.deepEqual(preferences, {
      whatsapp_enabled: false,
      telegram_enabled: false,
      fallback_enabled: false,
    });
    assert.equal(
      (
        await sql<{
          title: string;
        }>`select title from tasks where id=${upgradeTask}`.execute(db)
      ).rows[0]?.title,
      "M1 upgrade fixture",
    );
    const second = await createMigrator(db).migrateToLatest();
    assert.equal(second.error, undefined);
    assert.equal(second.results?.length, 0);
    await request(app).get("/health/ready").expect(200);
    await assert.rejects(
      sql`insert into foundation_metadata values (2, 1)`.execute(db),
    );
    const timezone = await sql<{ TimeZone: string }>`show timezone`.execute(db);
    assert.equal(timezone.rows[0]?.TimeZone, "UTC");
    await coreScenarios(db, connectionString);
    await multiUserScenarios(t, db, connectionString);
    await reminderScenarios(t, db, connectionString);
    await aiScenarios(t, db, connectionString);
    await chatActionScenarios(t, db, connectionString);
    await approvalScenarios(t, db, connectionString);
    await agentScenarios(t, db, connectionString);
    await notificationScenarios(t, db, connectionString);
    await telegramScenarios(t, db);
    await reminderRetentionScenarios(t, db);
    await planningScenarios(t, db, connectionString);
  } finally {
    await db.destroy();
  }
  const reconnected = createDatabase(connectionString);
  try {
    await checkDatabase(reconnected);
  } finally {
    await reconnected.destroy();
  }
});
