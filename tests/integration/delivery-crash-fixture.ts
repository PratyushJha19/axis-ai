// Test-only hard-exit harness. No external transport is used.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { createDatabase } from "../../packages/database/src/index.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { DeliveryEngine } from "../../services/worker/src/delivery.js";
import type { ChannelAdapter } from "../../packages/domain/src/notification-provider.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !/^\/axis_test_[a-z0-9_]+$/.test(new URL(url).pathname) ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  process.exit(2);
const db = createDatabase(url);
const adapter: ChannelAdapter = {
  async send(input) {
    const result = await sql<{
      provider_message_id: string;
    }>`insert into mock_notification_receipts(idempotency_key,provider_message_id) values (${input.key},${randomUUID()}) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning provider_message_id`.execute(
      db,
    );
    return {
      status: "delivered",
      messageId: result.rows[0]!.provider_message_id,
    };
  },
  async reconcile() {
    return { status: "unknown" };
  },
};
const engine = new DeliveryEngine(
  db,
  { whatsapp: adapter, email: adapter },
  createLogger("silent"),
  () => new Date("2026-10-12T12:00:00Z"),
);
const claim = await engine.claim();
if (!claim) process.exit(3);
if (process.argv[2] === "claim") process.exit(17);
const work = await engine.prepare(claim);
if (!work) process.exit(4);
if (process.argv[2] === "dispatch") process.exit(17);
const outcome = await adapter.send(work.input, new AbortController().signal);
if (process.argv[2] === "receipt") process.exit(17);
await engine.complete(work, outcome);
process.exit(17);
