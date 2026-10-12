// Test-only subprocess. Deliberately exits at persistence boundaries; never imported by the app.
import { createDatabase } from "../../packages/database/src/index.js";
import { createLogger } from "../../packages/observability/src/index.js";
import { ReminderEngine } from "../../services/worker/src/engine.js";
import { mockProvider } from "../../services/worker/src/provider.js";
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !/^\/axis_test_[a-z0-9_]+$/.test(new URL(url).pathname) ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  process.exit(2);
const db = createDatabase(url);
const provider = mockProvider(db);
const engine = new ReminderEngine(
  db,
  provider,
  createLogger("silent"),
  () => new Date("2026-10-11T12:00:00Z"),
);
const claim = await engine.claim();
if (!claim) process.exit(3);
if (process.argv[2] === "claim") process.exit(17);
const work = await engine.prepare(claim);
if (!work) process.exit(4);
if (process.argv[2] === "dispatch") process.exit(17);
const outcome = await provider.send(
  {
    key: work.attempt.idempotency_key,
    title: work.row.title,
    body: work.row.body,
  },
  new AbortController().signal,
);
if (process.argv[2] === "receipt") process.exit(17);
await engine.complete(work, outcome);
process.exit(17);
