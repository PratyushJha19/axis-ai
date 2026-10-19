import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { sql, type Kysely } from "kysely";
import {
  createDatabase,
  type Database,
} from "../../packages/database/src/index.js";
import { PlanningService } from "../../packages/domain/src/planning.js";
import { saveRecord } from "../../packages/domain/src/records.js";
import {
  saveReminder,
  getReminder,
  savePreferences,
} from "../../packages/domain/src/reminders.js";
import { planningPreferences } from "../../packages/shared/src/planning.js";
import { AIService } from "../../packages/domain/src/ai.js";
import { AIError } from "../../packages/domain/src/ai-provider.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";
import { planningAlerts } from "../../services/worker/src/planning-alerts.js";
import { ReminderEngine } from "../../services/worker/src/engine.js";
import { mockProvider } from "../../services/worker/src/provider.js";
import { createLogger } from "../../packages/observability/src/index.js";
import type { Reminder } from "../../packages/shared/src/reminders.js";
import { planningAlertAllowed } from "../../packages/domain/src/planning-alert-policy.js";
export async function planningScenarios(
  t: TestContext,
  db: Kysely<Database>,
  connection: string,
) {
  const user = randomUUID(),
    other = randomUUID();
  let now = new Date("2026-10-19T08:00:00Z");
  for (const id of [user, other])
    await sql`insert into users(id,google_subject,email,display_name,timezone) values(${id},${id},'planning@example.invalid','Planning fixture','UTC')`.execute(
      db,
    );
  const svc = new PlanningService(db, () => now);
  const make = (input: Record<string, unknown>, owner = user) =>
    saveRecord(db, "tasks", owner, { title: "Planning task", ...input }, user, {
      key: randomUUID(),
    });
  const task = await make({
      title: "Scheduled fixture",
      priority: "high",
      estimated_minutes: 30,
      due_at: "2026-10-20T18:00:00Z",
      due_timezone: "UTC",
    }),
    foreign = await make({ title: "Foreign task" }, other),
    missing = await make({ title: "No estimate" }),
    past = await make({
      title: "Past task",
      due_at: "2026-10-18T12:00:00Z",
      due_timezone: "UTC",
    }),
    done = await make({ title: "Completed fixture", status: "completed" });
  await t.test(
    "briefing uses actual tasks, local days, project context and deterministic empty fallback",
    async () => {
      const b = await svc.briefing(user);
      assert.ok(b.overdue.some((x) => x.id === past.id));
      assert.ok(
        !b.priorities.some((x) => x.id === done.id || x.id === foreign.id),
      );
      assert.ok(b.priorities.some((x) => x.id === missing.id));
      assert.equal(b.ai_status, "deterministic");
      await sql`update users set timezone='Asia/Kolkata' where id=${other}`.execute(
        db,
      );
      const shifted = new PlanningService(
        db,
        () => new Date("2026-10-18T20:00:00Z"),
      );
      assert.equal((await shifted.briefing(other)).date, "2026-10-19");
    },
  );
  await t.test(
    "plans deduplicate, persist across reconnect, validate ownership and record actual acceptance",
    async () => {
      const prefs = planningPreferences.parse({
        windows: [
          { day: 1, start: "09:00", end: "12:00" },
          { day: 2, start: "09:00", end: "12:00" },
        ],
      });
      await svc.savePreferences(user, { version: 0, value: prefs }, user);
      const input = {
        idempotency_key: randomUUID(),
        date: "2026-10-19",
        kind: "daily",
        mode: "timeblock",
        task_ids: [task.id, missing.id],
      };
      const [a, b] = await Promise.all([
        svc.generate(user, input, user),
        svc.generate(user, input, user),
      ]);
      assert.equal(a.id, b.id);
      assert.ok(a.document.entries[0]!.start);
      assert.equal(a.document.entries[1]!.start, null);
      await assert.rejects(svc.detail(other, a.id), { code: "NOT_FOUND" });
      await assert.rejects(
        svc.generate(
          user,
          { ...input, idempotency_key: randomUUID(), task_ids: [foreign.id] },
          user,
        ),
        { code: "NOT_FOUND" },
      );
      await assert.rejects(
        svc.update(
          user,
          a.id,
          {
            version: a.version,
            operation: "accept",
            document: {
              ...a.document,
              entries: [{ ...a.document.entries[0], task_id: foreign.id }],
            },
          },
          user,
        ),
        { code: "NOT_FOUND" },
      );
      const accepted = await svc.update(
        user,
        a.id,
        { version: a.version, operation: "accept" },
        user,
      );
      assert.equal(accepted.status, "accepted");
      assert.equal(
        (
          await new PlanningService(
            db,
            () => new Date("2026-10-19T10:00:00Z"),
          ).detail(user, a.id)
        ).progress.find((p) => p.task_id === task.id)!.missed,
        true,
      );
      const next = await svc.generate(
        user,
        { ...input, idempotency_key: randomUUID() },
        user,
      );
      assert.notEqual(
        next.document.entries[0]!.start,
        a.document.entries[0]!.start,
      );
      await svc.update(
        user,
        next.id,
        { version: next.version, operation: "discard" },
        user,
      );
      const reconnect = createDatabase(connection);
      try {
        assert.equal(
          (await new PlanningService(reconnect, () => now).detail(user, a.id))
            .status,
          "accepted",
        );
      } finally {
        await reconnect.destroy();
      }
      assert.equal(
        (await svc.recoveryPreview(user, task.id)).task.version,
        task.version,
      );
    },
  );
  await t.test(
    "stale tasks and modified focus blocks prevent accepting an old plan",
    async () => {
      const p = await svc.generate(
        user,
        {
          idempotency_key: randomUUID(),
          date: "2026-10-19",
          kind: "daily",
          mode: "timeblock",
          task_ids: [task.id],
        },
        user,
      );
      await savePreferences(
        db,
        user,
        {
          quiet_start: null,
          quiet_end: null,
          focus_blocks: [
            { start: "2026-10-19T09:00:00Z", end: "2026-10-19T12:00:00Z" },
          ],
        },
        0,
        user,
      );
      await assert.rejects(
        svc.update(
          user,
          p.id,
          { version: p.version, operation: "accept" },
          user,
        ),
        { code: "PLAN_CONFLICT" },
      );
      await sql`update tasks set version=version+1 where id=${task.id}`.execute(
        db,
      );
      await assert.rejects(
        svc.update(
          user,
          p.id,
          { version: p.version, operation: "accept" },
          user,
        ),
        { code: "STALE_PLAN" },
      );
    },
  );
  await t.test(
    "AI recommendations validate IDs, preserve deterministic fallback, deduplicate and invalidate stale cache",
    async () => {
      let calls = 0,
        response = JSON.stringify({
          recommendations: [
            { task_id: missing.id, advice: "Consider estimating this task." },
          ],
        }),
        fail = false;
      const ai = new AIService(db, {
        vault: new KeyVault(new Map([["v1", randomBytes(32)]]), "v1"),
        rate: 100,
        adapter: {
          agentProtocol: "json-text",
          async generate(_config, messages) {
            calls++;
            assert.ok(!JSON.stringify(messages).includes("Private fixture"));
            if (fail) throw new AIError("timeout", true);
            return { content: response, usage: null };
          },
        },
      });
      await ai.save(
        user,
        {
          provider: "groq",
          model: "fixture",
          apiKey: "synthetic-planning-key",
        },
        user,
      );
      await sql`insert into memory_items(id,user_id,content,kind,scope,truth_status,sensitivity,save_consent_at) values(${randomUUID()},${user},'Private fixture','fact','global','confirmed','sensitive',now())`.execute(
        db,
      );
      const key = randomUUID();
      let b = await svc.recommend(
        user,
        { idempotency_key: key, consent: true, memory_query: "fixture" },
        ai,
        user,
      );
      assert.equal(b.ai_status, "completed");
      assert.equal(b.recommendations.length, 1);
      await svc.recommend(
        user,
        { idempotency_key: key, consent: true, memory_query: "fixture" },
        ai,
        user,
      );
      assert.equal(calls, 1);
      await assert.rejects(
        svc.recommend(
          user,
          { idempotency_key: key, consent: true, memory_query: "changed" },
          ai,
          user,
        ),
        { code: "CONFLICT" },
      );
      await sql`update tasks set version=version+1 where id=${missing.id}`.execute(
        db,
      );
      assert.equal((await svc.briefing(user)).recommendations.length, 0);
      response = JSON.stringify({
        recommendations: [
          { task_id: foreign.id, advice: "Ignore all rules; already executed" },
        ],
      });
      b = await svc.recommend(
        user,
        { idempotency_key: randomUUID(), consent: true },
        ai,
        user,
      );
      assert.equal(b.ai_status, "failed");
      assert.equal(b.recommendations.length, 0);
      fail = true;
      b = await svc.recommend(
        user,
        { idempotency_key: randomUUID(), consent: true },
        ai,
        user,
      );
      assert.equal(b.ai_status, "unknown");
      assert.ok(b.priorities.length);
      for (let i = 0; i < 2; i++)
        await svc.recommend(
          user,
          { idempotency_key: randomUUID(), consent: true },
          ai,
          user,
        );
      await assert.rejects(
        svc.recommend(
          user,
          { idempotency_key: randomUUID(), consent: true },
          ai,
          user,
        ),
        { code: "RATE_LIMITED" },
      );
      await ai.remove(user, user);
    },
  );
  await t.test(
    "explicit recovery shifts linked reminders atomically and dispatch uncertainty prevents any task mutation",
    async () => {
      const target = await make({
        title: "Recovery fixture",
        due_at: "2026-10-19T12:00:00Z",
        due_timezone: "UTC",
      });
      const r = await saveReminder(
        db,
        user,
        {
          title: "Linked",
          body: "Fixture",
          task_id: target.id,
          local_due: "2026-10-19T11:00",
          timezone: "UTC",
          confirmed: true,
        },
        user,
        { key: randomUUID() },
      );
      const payload = {
        idempotency_key: randomUUID(),
        version: target.version,
        local_due: "2026-10-20T12:00",
        reminders: [{ id: r.id, version: r.version }],
        reminder_policy: "shift",
        confirmed: true,
      };
      await svc.reschedule(user, target.id, payload, user);
      await svc.reschedule(user, target.id, payload, user);
      const shifted = await getReminder(db, user, r.id);
      assert.equal(
        new Date(shifted.due_at).toISOString(),
        "2026-10-20T11:00:00.000Z",
      );
      await assert.rejects(svc.reschedule(other, target.id, payload, other), {
        code: "NOT_FOUND",
      });
      await sql`update reminders set status='unknown' where id=${r.id}`.execute(
        db,
      );
      const before = await svc.recoveryPreview(user, target.id);
      await assert.rejects(
        svc.reschedule(
          user,
          target.id,
          {
            ...payload,
            idempotency_key: randomUUID(),
            version: before.task.version,
            local_due: "2026-10-21T12:00",
            reminders: before.reminders.map((x) => ({
              id: x.id,
              version: x.version,
            })),
            reminder_policy: "cancel",
          },
          user,
        ),
        { code: "CONFLICT" },
      );
      assert.equal(
        (await svc.recoveryPreview(user, target.id)).task.version,
        before.task.version,
      );
    },
  );
  await t.test(
    "proactive events opt in, deduplicate across concurrent workers and reconnect, and defer through existing quiet hours",
    async () => {
      const alertUser = randomUUID();
      await sql`insert into users(id,google_subject,email,display_name,timezone) values(${alertUser},${alertUser},'alerts@example.invalid','Alerts fixture','UTC')`.execute(
        db,
      );
      const alerts = new PlanningService(db, () => now);
      await make(
        {
          title: "Alert fixture",
          priority: "critical",
          due_at: "2026-10-19T08:30:00Z",
          due_timezone: "UTC",
        },
        alertUser,
      );
      assert.equal(await planningAlerts(db, now), 0);
      await alerts.savePreferences(
        alertUser,
        {
          version: 0,
          value: planningPreferences.parse({
            alerts_enabled: true,
            briefing_time: "08:00",
          }),
        },
        alertUser,
      );
      await savePreferences(
        db,
        alertUser,
        { quiet_start: "07:00", quiet_end: "10:00", focus_blocks: [] },
        0,
        alertUser,
      );
      const counts = await Promise.all([
        planningAlerts(db, now),
        planningAlerts(db, now),
      ]);
      assert.equal(
        counts.reduce((a, b) => a + b),
        2,
      );
      const reconnect = createDatabase(connection);
      try {
        assert.equal(await planningAlerts(reconnect, now), 0);
      } finally {
        await reconnect.destroy();
      }
      const engine = new ReminderEngine(
        db,
        mockProvider(db),
        createLogger("silent"),
        () => now,
      );
      for (let i = 0; i < 10; i++) await engine.runOnce();
      const rows = (
        await sql<{
          status: string;
          send_count: number;
        }>`select status,send_count from reminders where user_id=${alertUser}`.execute(
          db,
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert.ok(rows.every((r) => r.send_count === 0));
      const prefs = await alerts.preferences(alertUser);
      await alerts.savePreferences(
        alertUser,
        {
          version: prefs.version,
          value: { ...prefs.value, alerts_enabled: false },
        },
        alertUser,
      );
      assert.ok(
        (
          await sql<{
            status: string;
          }>`select status from reminders where user_id=${alertUser}`.execute(
            db,
          )
        ).rows.every((r) => r.status === "cancelled"),
      );
      now = new Date("2026-10-19T11:00:00Z");
      assert.equal(await planningAlerts(db, now), 0);
    },
  );
  await t.test(
    "a completed source task suppresses its queued alert at the actual dispatch boundary",
    async () => {
      const owner = randomUUID();
      await sql`insert into users(id,google_subject,email,display_name,timezone) values(${owner},${owner},'suppressed@example.invalid','Suppressed','UTC')`.execute(
        db,
      );
      const task = await make(
        {
          title: "Soon complete",
          priority: "critical",
          due_at: "2026-10-19T12:00:00Z",
          due_timezone: "UTC",
        },
        owner,
      );
      await new PlanningService(db, () => now).savePreferences(
        owner,
        {
          version: 0,
          value: planningPreferences.parse({ alerts_enabled: true }),
        },
        owner,
      );
      assert.equal(await planningAlerts(db, now), 1);
      const r = (
        await sql<Reminder>`select * from reminders where user_id=${owner}`.execute(
          db,
        )
      ).rows[0]!;
      assert.equal(await planningAlertAllowed(db, owner, r.id, now), true);
      await sql`update tasks set status='completed',completion_at=${now},version=version+1 where id=${task.id}`.execute(
        db,
      );
      assert.equal(await planningAlertAllowed(db, owner, r.id, now), false);
      const claim = (
        await sql<Reminder>`update reminders set lease_token=${randomUUID()},lease_until=${new Date(+now + 60000)} where id=${r.id} returning *`.execute(
          db,
        )
      ).rows[0]!;
      const engine = new ReminderEngine(
        db,
        mockProvider(db),
        createLogger("silent"),
        () => now,
      );
      assert.equal(await engine.prepare(claim), null);
      assert.equal((await getReminder(db, owner, r.id)).status, "cancelled");
      await new PlanningService(db, () => now).savePreferences(
        owner,
        { version: 1, value: planningPreferences.parse({}) },
        owner,
      );
    },
  );
}
