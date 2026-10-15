import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { sql, type Kysely } from "kysely";
import {
  createDatabase,
  type Database,
} from "../../packages/database/src/index.js";
import {
  saveReminder,
  getReminder,
  cancelReminder,
  snoozeReminder,
  savePreferences,
  reconcileReminder,
} from "../../packages/domain/src/reminders.js";
import { ReminderEngine } from "../../services/worker/src/engine.js";
import {
  mockProvider,
  type NotificationProvider,
  type Outcome,
} from "../../services/worker/src/provider.js";
import { createLogger } from "../../packages/observability/src/index.js";
import type { ReminderInput } from "../../packages/shared/src/reminders.js";

export async function reminderScenarios(
  t: TestContext,
  db: Kysely<Database>,
  connectionString: string,
) {
  let now = new Date("2026-10-11T12:00:00Z");
  let owner = "";
  let logs = "";
  const logger = createLogger("info", {
    write: (s: string) => {
      logs += s;
    },
  });
  const mock = mockProvider(db);
  const engine = (provider: NotificationProvider = mock) =>
    new ReminderEngine(
      db,
      provider,
      logger,
      () => now,
      {},
      () => 0.5,
    );
  const input = (extra: Partial<ReminderInput> = {}): ReminderInput => ({
    title: "Synthetic reminder",
    body: "synthetic-private-reminder",
    local_due: "2026-10-11T12:00",
    timezone: "UTC",
    disambiguation: "reject",
    recurrence: "none",
    task_id: null,
    project_id: null,
    confirmed: true,
    ...extra,
  });
  const create = (extra: Partial<ReminderInput> = {}) =>
    saveReminder(db, owner, input(extra), randomUUID(), { key: randomUUID() });
  async function scenario(name: string, fn: () => Promise<void>) {
    await t.test(name, async () => {
      now = new Date("2026-10-11T12:00:00Z");
      owner = randomUUID();
      await sql`insert into users(id,google_subject,email,display_name,timezone) values (${owner},${owner},'test@example.invalid','Synthetic','UTC')`.execute(
        db,
      );
      try {
        await fn();
      } finally {
        // Retain evidence but keep later scenarios' global workers from selecting these jobs.
        await sql`update reminders set next_attempt_at=null,lease_token=null,lease_until=null where user_id=${owner}`.execute(
          db,
        );
      }
    });
  }
  await scenario(
    "idempotent creation, optimistic edits and cross-owner isolation",
    async () => {
      const key = randomUUID();
      const [a, b] = await Promise.all([
        saveReminder(db, owner, input(), randomUUID(), { key }),
        saveReminder(db, owner, input(), randomUUID(), { key }),
      ]);
      assert.equal(a.id, b.id);
      await assert.rejects(
        saveReminder(db, owner, input({ title: "changed" }), randomUUID(), {
          key,
        }),
      );
      await assert.rejects(getReminder(db, randomUUID(), a.id));
      await assert.rejects(
        cancelReminder(db, randomUUID(), a.id, 1, randomUUID()),
      );
      const edited = await saveReminder(
        db,
        owner,
        input({ local_due: "2026-10-12T12:00" }),
        randomUUID(),
        { id: a.id, version: 1 },
      );
      assert.equal(edited.version, 2);
      assert.equal(edited.occurrence, 2);
      await assert.rejects(
        saveReminder(db, owner, input(), randomUUID(), {
          id: a.id,
          version: 1,
        }),
      );
      assert.equal(await engine().runOnce(), false);
      await cancelReminder(db, owner, a.id, 2, randomUUID());
    },
  );
  await scenario(
    "concurrent workers claim one logical reminder and record one receipt",
    async () => {
      const row = await create();
      await Promise.all(Array.from({ length: 8 }, () => engine().runOnce()));
      assert.equal((await getReminder(db, owner, row.id)).status, "delivered");
      const attempts = await sql<{
        n: number;
      }>`select count(*)::int n from notification_attempts where reminder_id=${row.id}`.execute(
        db,
      );
      assert.equal(attempts.rows[0]?.n, 1);
      assert.equal(
        (
          await sql<{
            n: number;
          }>`select count(*)::int n from mock_notification_receipts where idempotency_key=${`${row.idempotency_key}:1`}`.execute(
            db,
          )
        ).rows[0]?.n,
        1,
      );
    },
  );
  await scenario(
    "crash after claim is reclaimed; stale claim cannot dispatch",
    async () => {
      const row = await create(),
        first = engine();
      const claim = await first.claim();
      assert.ok(claim);
      assert.equal(await engine().claim(), null);
      now = new Date(now.getTime() + 61000);
      await engine().runOnce();
      assert.equal(await first.prepare(claim), null);
      assert.equal((await getReminder(db, owner, row.id)).status, "delivered");
    },
  );
  await scenario(
    "crash after dispatch marker before provider reconciles non-delivery before retry",
    async () => {
      const row = await create(),
        first = engine(),
        claim = await first.claim();
      assert.ok(claim);
      assert.ok(await first.prepare(claim));
      now = new Date(now.getTime() + 61000);
      await engine().runOnce();
      const recovered = await getReminder(db, owner, row.id);
      assert.equal(recovered.status, "failed");
      assert.equal(recovered.reason, "retry_scheduled");
      now = new Date(recovered.next_attempt_at!);
      await engine().runOnce();
      assert.equal((await getReminder(db, owner, row.id)).status, "delivered");
    },
  );
  await scenario(
    "crash after provider receipt before DB result reconciles without resend; stale completion fenced",
    async () => {
      const row = await create(),
        first = engine(),
        claim = await first.claim();
      assert.ok(claim);
      const work = await first.prepare(claim);
      assert.ok(work);
      const outcome = await mock.send(
        { key: work.attempt.idempotency_key, title: row.title, body: row.body },
        new AbortController().signal,
      );
      now = new Date(now.getTime() + 61000);
      await engine().runOnce();
      await first.complete(work, { status: "failed", category: "permanent" });
      assert.equal((await getReminder(db, owner, row.id)).status, "delivered");
      assert.equal(
        (
          await mock.reconcile(
            work.attempt.idempotency_key,
            new AbortController().signal,
          )
        ).messageId,
        outcome.messageId,
      );
      assert.equal((await getReminder(db, owner, row.id)).send_count, 1);
    },
  );
  await scenario(
    "provider timeout stays unknown then reconciles delivered; no blind second send",
    async () => {
      const row = await create();
      let sends = 0;
      const provider: NotificationProvider = {
        name: "mock",
        async send(v, s) {
          sends++;
          await mock.send(v, s);
          return new Promise<Outcome>(() => {}); // Receipt exists, but response never arrives.
        },
        reconcile: mock.reconcile,
      };
      await new ReminderEngine(
        db,
        provider,
        logger,
        () => now,
        { timeoutMs: 10 },
        () => 0.5,
      ).runOnce();
      let saved = await getReminder(db, owner, row.id);
      assert.equal(saved.status, "unknown");
      await assert.rejects(
        cancelReminder(db, owner, row.id, saved.version, randomUUID()),
      );
      now = new Date(saved.next_attempt_at!);
      await engine(provider).runOnce();
      saved = await getReminder(db, owner, row.id);
      assert.equal(saved.status, "delivered");
      assert.equal(sends, 1);
    },
  );
  await scenario(
    "unresolved provider outcomes stop after bounded reconciliation and remain visible",
    async () => {
      const row = await create();
      let sends = 0;
      const provider: NotificationProvider = {
        name: "mock",
        async send() {
          sends++;
          return { status: "unknown" };
        },
        async reconcile() {
          return { status: "unknown" };
        },
      };
      await engine(provider).runOnce();
      for (let i = 0; i < 3; i++) {
        now = new Date((await getReminder(db, owner, row.id)).next_attempt_at!);
        await engine(provider).runOnce();
      }
      const saved = await getReminder(db, owner, row.id);
      assert.equal(saved.status, "unknown");
      assert.equal(saved.attention, true);
      assert.equal(saved.next_attempt_at, null);
      assert.equal(sends, 1);
    },
  );
  await scenario(
    "cancellation wins after claim but before dispatch; dispatch-first cancellation is rejected",
    async () => {
      const row = await create(),
        worker = engine(),
        claim = await worker.claim();
      assert.ok(claim);
      await cancelReminder(db, owner, row.id, row.version, randomUUID());
      assert.equal(await worker.prepare(claim), null);
      assert.equal(
        (
          await sql`select id from notification_attempts where reminder_id=${row.id}`.execute(
            db,
          )
        ).rows.length,
        0,
      );
      const other = await create(),
        c = await worker.claim();
      assert.ok(c);
      assert.ok(await worker.prepare(c));
      const saved = await getReminder(db, owner, other.id);
      await assert.rejects(
        cancelReminder(db, owner, other.id, saved.version, randomUUID()),
      );
    },
  );
  await scenario(
    "snooze survives reconnection and prevents early send",
    async () => {
      const row = await create();
      await snoozeReminder(
        db,
        owner,
        row.id,
        1,
        new Date("2026-10-11T13:00Z"),
        randomUUID(),
        now,
      );
      const restartedDb = createDatabase(connectionString);
      try {
        assert.equal(
          (await getReminder(restartedDb, owner, row.id)).status,
          "snoozed",
        );
        assert.equal(await engine().runOnce(), false);
        now = new Date("2026-10-11T13:00Z");
        await new ReminderEngine(
          restartedDb,
          mockProvider(restartedDb),
          logger,
          () => now,
        ).runOnce();
        assert.equal(
          (await getReminder(db, owner, row.id)).status,
          "delivered",
        );
      } finally {
        await restartedDb.destroy();
      }
    },
  );
  await scenario(
    "quiet hours and chained focus blocks persist deferral and send once after release",
    async () => {
      await savePreferences(
        db,
        owner,
        {
          quiet_start: "11:00",
          quiet_end: "13:00",
          focus_blocks: [
            { start: "2026-10-11T13:00:00Z", end: "2026-10-11T14:00:00Z" },
          ],
        },
        0,
        randomUUID(),
      );
      const row = await create();
      await engine().runOnce();
      let saved = await getReminder(db, owner, row.id);
      assert.equal(
        new Date(saved.next_attempt_at!).toISOString(),
        "2026-10-11T14:00:00.000Z",
      );
      assert.equal(saved.send_count, 0);
      now = new Date("2026-10-11T14:00Z");
      await engine().runOnce();
      saved = await getReminder(db, owner, row.id);
      assert.equal(saved.status, "delivered");
      assert.equal(saved.send_count, 1);
    },
  );
  await scenario(
    "transient retries are bounded and provider retry-after is respected",
    async () => {
      const row = await create();
      const provider: NotificationProvider = {
        name: "mock",
        async send() {
          return {
            status: "failed",
            category: "rate_limit",
            retryAfterMs: 90000,
          };
        },
        reconcile: mock.reconcile,
      };
      await engine(provider).runOnce();
      let saved = await getReminder(db, owner, row.id);
      assert.equal(
        new Date(saved.next_attempt_at!).getTime() - now.getTime(),
        90000,
      );
      for (let i = 0; i < 2; i++) {
        now = new Date(saved.next_attempt_at!);
        await engine(provider).runOnce();
        saved = await getReminder(db, owner, row.id);
      }
      assert.equal(saved.send_count, 3);
      assert.equal(saved.reason, "retry_exhausted");
      assert.equal(saved.attention, true);
      assert.equal(saved.next_attempt_at, null);
    },
  );
  await scenario(
    "permanent and configuration errors do not retry",
    async () => {
      for (const category of ["permanent", "configuration"] as const) {
        const row = await create();
        await engine({
          name: "mock",
          async send() {
            return { status: "failed", category };
          },
          reconcile: mock.reconcile,
        }).runOnce();
        const saved = await getReminder(db, owner, row.id);
        assert.equal(saved.next_attempt_at, null);
        assert.equal(saved.attention, true);
      }
    },
  );
  await scenario(
    "recurrence advances once, reports skipped repeats, and duplicate completion is harmless",
    async () => {
      const row = await create({
          local_due: "2026-10-01T12:00",
          recurrence: "daily",
        }),
        worker = engine(),
        claim = await worker.claim();
      assert.ok(claim);
      const work = await worker.prepare(claim);
      assert.ok(work);
      const outcome: Outcome = { status: "delivered", messageId: randomUUID() };
      await worker.complete(work, outcome);
      await worker.complete(work, outcome);
      const saved = await getReminder(db, owner, row.id);
      assert.equal(saved.occurrence, 2);
      assert.equal(saved.skipped_count, 10);
      assert.equal(saved.local_due, "2026-10-12T12:00");
      assert.equal(saved.status, "scheduled");
    },
  );
  await scenario(
    "real worker processes reminders after restart with no API or model server",
    async () => {
      // Real wall clock, local test DB only, no live OAuth/provider values are forwarded.
      const row = await create({ local_due: "2026-01-01T00:00" });
      const start = () =>
        spawn(
          process.execPath,
          ["--import", "tsx", "services/worker/src/main.ts"],
          {
            env: {
              ...process.env,
              DATABASE_URL: connectionString,
              NOTIFICATION_MODE: "mock",
              TELEGRAM_BOT_TOKEN: "",
              RESEND_API_KEY: "",
              LOG_LEVEL: "silent",
              OPENAI_BASE_URL: "http://127.0.0.1:1",
              OPENAI_API_KEY: "synthetic-disabled",
              AI_CREDENTIALS_ENCRYPTION_KEY: "synthetic-invalid-ai-key",
              GOOGLE_CLIENT_ID: "",
              GOOGLE_CLIENT_SECRET: "",
              OWNER_EMAIL: "",
              SESSION_SECRET: "",
            },
            stdio: "ignore",
          },
        );
      const waitFor = async (id: string) => {
        for (let i = 0; i < 100; i++) {
          if ((await getReminder(db, owner, id)).status === "delivered") return;
          await delay(100);
        }
        throw new Error("Worker did not process persisted reminder");
      };
      let child = start();
      try {
        await waitFor(row.id);
        const closed = once(child, "exit");
        child.kill();
        await closed;
        const second = await create({
          title: "Synthetic restart reminder",
          local_due: "2026-01-01T00:00",
        });
        child = start();
        await waitFor(second.id);
      } finally {
        if (child.exitCode === null) {
          const closed = once(child, "exit");
          child.kill();
          await closed;
        }
      }
    },
  );
  await scenario(
    "reminder remains scheduled across two real API process starts and stops",
    async () => {
      const row = await create();
      for (let cycle = 0; cycle < 2; cycle++) {
        const reservation = createServer();
        reservation.listen(0, "127.0.0.1");
        await once(reservation, "listening");
        const address = reservation.address();
        assert.ok(address && typeof address !== "string");
        await new Promise<void>((resolve) =>
          reservation.close(() => resolve()),
        );
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "services/api/src/main.ts"],
          {
            env: {
              ...process.env,
              DATABASE_URL: connectionString,
              PORT: String(address.port),
              LOG_LEVEL: "silent",
              GOOGLE_CLIENT_ID: "",
              GOOGLE_CLIENT_SECRET: "",
              OWNER_EMAIL: "",
              SESSION_SECRET: "",
            },
            stdio: "ignore",
          },
        );
        try {
          let ready = false;
          for (let i = 0; i < 100; i++) {
            try {
              ready = (
                await fetch(`http://127.0.0.1:${address.port}/health/ready`)
              ).ok;
            } catch {
              /* Startup may still be binding. */
            }
            if (ready) break;
            await delay(100);
          }
          assert.equal(ready, true);
          assert.equal(
            (await getReminder(db, owner, row.id)).status,
            "scheduled",
          );
        } finally {
          if (child.exitCode === null) {
            const closed = once(child, "exit");
            child.kill();
            await closed;
          }
        }
      }
      await engine().runOnce();
      assert.equal((await getReminder(db, owner, row.id)).status, "delivered");
    },
  );
  await scenario(
    "hard process exits at claim, dispatch, receipt and completed-result boundaries recover safely",
    async () => {
      for (const phase of ["claim", "dispatch", "receipt", "complete"]) {
        now = new Date("2026-10-11T12:00:00Z");
        const row = await create();
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            "tests/integration/worker-crash-fixture.ts",
            phase,
          ],
          {
            env: { ...process.env, TEST_DATABASE_URL: connectionString },
            stdio: "ignore",
          },
        );
        const [code] = await once(child, "exit");
        assert.equal(code, 17);
        now = new Date("2026-10-11T12:01:01Z");
        await engine().runOnce();
        let saved = await getReminder(db, owner, row.id);
        if (saved.next_attempt_at && saved.status !== "delivered") {
          now = new Date(saved.next_attempt_at);
          await engine().runOnce();
          saved = await getReminder(db, owner, row.id);
        }
        assert.equal(saved.status, "delivered");
        assert.equal(
          (
            await sql<{
              n: number;
            }>`select count(*)::int n from mock_notification_receipts where idempotency_key=${`${row.idempotency_key}:1`}`.execute(
              db,
            )
          ).rows[0]?.n,
          1,
        );
      }
    },
  );
  await scenario(
    "owner can request bounded reconciliation again without authorizing a blind resend",
    async () => {
      const row = await create();
      let sends = 0;
      const uncertain: NotificationProvider = {
        name: "mock",
        async send() {
          sends++;
          return { status: "unknown" };
        },
        async reconcile() {
          return { status: "unknown" };
        },
      };
      await engine(uncertain).runOnce();
      for (let i = 0; i < 3; i++) {
        now = new Date((await getReminder(db, owner, row.id)).next_attempt_at!);
        await engine(uncertain).runOnce();
      }
      const saved = await getReminder(db, owner, row.id);
      await reconcileReminder(
        db,
        owner,
        row.id,
        saved.version,
        randomUUID(),
        now,
      );
      const provider: NotificationProvider = {
        ...uncertain,
        async reconcile() {
          return { status: "delivered", messageId: randomUUID() };
        },
      };
      await engine(provider).runOnce();
      assert.equal((await getReminder(db, owner, row.id)).status, "delivered");
      assert.equal(sends, 1);
    },
  );
  await scenario(
    "preferences saved after claim still suppress dispatch; overlap is rejected",
    async () => {
      const row = await create(),
        worker = engine(),
        claim = await worker.claim();
      assert.ok(claim);
      await savePreferences(
        db,
        owner,
        { quiet_start: "11:00", quiet_end: "14:00", focus_blocks: [] },
        0,
        randomUUID(),
      );
      assert.equal(await worker.prepare(claim), null);
      assert.equal((await getReminder(db, owner, row.id)).send_count, 0);
      await assert.rejects(
        savePreferences(
          db,
          owner,
          {
            quiet_start: null,
            quiet_end: null,
            focus_blocks: [
              { start: "2026-10-11T12:00:00Z", end: "2026-10-11T14:00:00Z" },
              { start: "2026-10-11T13:00:00Z", end: "2026-10-11T15:00:00Z" },
            ],
          },
          1,
          randomUUID(),
        ),
      );
    },
  );
  await scenario(
    "unconfirmed sent state and future DST ambiguity remain visible without false delivery",
    async () => {
      const row = await create();
      await engine({
        name: "mock",
        async send() {
          return { status: "sent", messageId: randomUUID() };
        },
        async reconcile() {
          return { status: "unknown" };
        },
      }).runOnce();
      assert.equal((await getReminder(db, owner, row.id)).status, "sent");
      await sql`update reminders set next_attempt_at=null where id=${row.id}`.execute(
        db,
      );
      await sql`update users set timezone='America/New_York' where id=${owner}`.execute(
        db,
      );
      now = new Date("2026-03-07T08:00:00Z");
      const recurring = await create({
        timezone: "America/New_York",
        local_due: "2026-03-07T02:30",
        recurrence: "daily",
      });
      await engine().runOnce();
      const saved = await getReminder(db, owner, recurring.id);
      assert.equal(saved.reason, "recurrence_time_needs_review");
      assert.equal(saved.attention, true);
      assert.equal(saved.next_attempt_at, null);
    },
  );
  await scenario(
    "worker health CLI reports fresh heartbeat and detects stale heartbeat",
    async () => {
      const health = async () => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "services/worker/src/health.ts"],
          {
            env: {
              ...process.env,
              DATABASE_URL: connectionString,
              NOTIFICATION_MODE: "mock",
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        child.stdout.on("data", (v: Buffer) => {
          output += v.toString();
        });
        const [code] = await once(child, "close");
        return { code, output };
      };
      await sql`update worker_heartbeats set last_seen_at=now()`.execute(db);
      const fresh = await health();
      assert.equal(fresh.code, 0);
      assert.match(fresh.output, /ready/);
      await sql`update worker_heartbeats set last_seen_at=now()-interval '2 minutes'`.execute(
        db,
      );
      const stale = await health();
      assert.equal(stale.code, 1);
      assert.match(stale.output, /stale_or_stopped/);
    },
  );
  assert.ok(!logs.includes("synthetic-private"));
}
