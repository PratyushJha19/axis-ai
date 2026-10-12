import { sql } from "kysely";
import { createDatabase } from "../packages/database/src/index.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !/^\/axis_test_[a-z0-9_]+$/.test(new URL(url).pathname) ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  throw new Error("Isolated test database required");
const db = createDatabase(url);
try {
  const result = await sql<{
    count: number;
  }>`select count(*)::int as count from tasks where title='Synthetic task' and status='completed'`.execute(
    db,
  );
  if (result.rows[0]?.count !== 1)
    throw new Error("Persistence verification failed");
  console.log("PASS: saved completed task survived a real PostgreSQL restart.");
  const reminders = await sql<{
    delivered: number;
    attempts: number;
    receipts: number;
  }>`select
    (select count(*)::int from reminders where status='delivered') as delivered,
    (select count(*)::int from notification_attempts where status='delivered') as attempts,
    (select count(*)::int from mock_notification_receipts) as receipts`.execute(
    db,
  );
  const evidence = reminders.rows[0];
  if (
    !evidence ||
    evidence.delivered < 1 ||
    evidence.attempts < 1 ||
    evidence.receipts < 1
  )
    throw new Error("Reminder persistence verification failed");
  console.log(
    "PASS: delivered reminders, attempt history and mock receipts survived a real PostgreSQL restart.",
  );
  const ai = (
    await sql<{
      configs: number;
      messages: number;
      unknowns: number;
    }>`select (select count(*)::int from ai_configs) as configs, (select count(*)::int from ai_messages where role='assistant') as messages, (select count(*)::int from ai_requests where status='unknown') as unknowns`.execute(
      db,
    )
  ).rows[0];
  if (!ai || ai.configs < 2 || ai.messages < 1 || ai.unknowns < 1)
    throw new Error("AI persistence verification failed");
  console.log(
    "PASS: encrypted AI settings, chat responses and unknown requests survived a real PostgreSQL restart.",
  );
  const delivery = (
    await sql<{
      delivered: number;
      unknowns: number;
      attempts: number;
    }>`select (select count(*)::int from notification_jobs where status='delivered') as delivered,(select count(*)::int from notification_jobs where status='unknown') as unknowns,(select count(*)::int from notification_attempts where job_id is not null) as attempts`.execute(
      db,
    )
  ).rows[0];
  if (
    !delivery ||
    delivery.delivered < 1 ||
    delivery.unknowns < 1 ||
    delivery.attempts < 1
  )
    throw new Error("M3 delivery persistence verification failed");
  console.log(
    "PASS: channel delivery evidence, uncertain outcomes and transport attempts survived a real PostgreSQL restart.",
  );
} finally {
  await db.destroy();
}
