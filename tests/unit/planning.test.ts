import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  rankTasks,
  localDate,
  weekStart,
  dayRange,
  buildPlan,
  validatePlan,
} from "../../packages/domain/src/planning-engine.js";
import {
  planningPreferences,
  type PlanningTask,
} from "../../packages/shared/src/planning.js";
const now = new Date("2026-10-19T08:00:00Z");
const task = (extra: Partial<PlanningTask> = {}): PlanningTask => ({
  id: randomUUID(),
  title: "Fixture",
  status: "inbox",
  priority: "normal",
  due_at: null,
  estimated_minutes: 30,
  project_id: null,
  version: 1,
  completion_at: null,
  updated_at: now.toISOString(),
  ...extra,
});
test("planning ranking is reproducible, explains real urgency, and excludes finished work", () => {
  const overdue = task({ due_at: "2026-10-18T09:00:00Z" }),
    high = task({ priority: "critical" }),
    soon = task({ due_at: "2026-10-19T09:00:00Z" }),
    missing = task({ estimated_minutes: null }),
    finished = task({ status: "completed" }),
    cancelled = task({ status: "cancelled" });
  const ranked = rankTasks(
    [high, soon, missing, finished, cancelled, overdue],
    now,
  );
  assert.equal(ranked[0]!.id, overdue.id);
  assert.equal(ranked[1]!.id, soon.id);
  assert.equal(ranked.length, 4);
  assert.ok(
    ranked
      .find((t) => t.id === missing.id)!
      .reasons.includes("No duration estimate"),
  );
  assert.deepEqual(rankTasks([missing, high, soon, overdue], now), ranked);
  const a = task(),
    b = task();
  assert.deepEqual(rankTasks([a, b], now), rankTasks([b, a], now));
});
test("planning boundaries use IANA local dates, configurable week start and DST-length days", () => {
  assert.equal(
    localDate(new Date("2026-10-18T20:00:00Z"), "Asia/Kolkata"),
    "2026-10-19",
  );
  assert.equal(weekStart("2026-10-18", 1), "2026-10-12");
  assert.equal(weekStart("2026-10-18", 7), "2026-10-18");
  const spring = dayRange("2026-03-08", "America/New_York"),
    fall = dayRange("2026-11-01", "America/New_York");
  assert.equal(+spring.end - +spring.start, 23 * 3600000);
  assert.equal(+fall.end - +fall.start, 25 * 3600000);
});
test("daily and weekly scheduling enforce capacity, buffers, focus, deadlines and unknown estimates", () => {
  const prefs = planningPreferences.parse({
    windows: [
      { day: 1, start: "09:00", end: "10:00" },
      { day: 2, start: "09:00", end: "11:00" },
    ],
    buffer_minutes: 10,
  });
  const a = task(),
    b = task(),
    missing = task({ estimated_minutes: null }),
    late = task({ due_at: "2026-10-19T08:30:00Z" }),
    blocked = task({ status: "blocked" });
  const tasks = [a, b, missing, late, blocked];
  const day = buildPlan(
    tasks,
    "2026-10-19",
    "daily",
    "timeblock",
    "UTC",
    prefs,
    [],
    now,
  );
  assert.equal(day.entries[0]!.start, "2026-10-19T09:00:00.000Z");
  assert.equal(day.entries[1]!.start, null);
  assert.equal(day.entries.filter((e) => e.start).length, 1);
  validatePlan(day, tasks, prefs, [], now);
  const week = buildPlan(
    tasks,
    "2026-10-19",
    "weekly",
    "timeblock",
    "UTC",
    prefs,
    [],
    now,
  );
  assert.equal(week.entries[1]!.start, "2026-10-20T09:00:00.000Z");
  validatePlan(week, tasks, prefs, [], now);
  assert.equal(
    buildPlan(
      [a],
      "2026-10-19",
      "daily",
      "timeblock",
      "UTC",
      prefs,
      [{ start: "2026-10-19T09:00:00Z", end: "2026-10-19T10:00:00Z" }],
      now,
    ).entries[0]!.start,
    null,
  );
  const forged = structuredClone(day);
  forged.entries[1] = { ...forged.entries[0]!, task_id: b.id };
  assert.throws(() => validatePlan(forged, tasks, prefs, [], now), {
    code: "PLAN_CONFLICT",
  });
  assert.throws(
    () =>
      validatePlan(
        day,
        [{ ...a, version: 2 }, b, missing, late, blocked],
        prefs,
        [],
        now,
      ),
    { code: "STALE_PLAN" },
  );
});
test("missing availability and DST ambiguity never invent usable capacity", () => {
  const tasks = [task()];
  assert.equal(
    buildPlan(
      tasks,
      "2026-10-19",
      "daily",
      "timeblock",
      "UTC",
      planningPreferences.parse({}),
      [],
      now,
    ).entries[0]!.start,
    null,
  );
  const p = buildPlan(
    tasks,
    "2026-11-01",
    "daily",
    "timeblock",
    "America/New_York",
    planningPreferences.parse({
      windows: [{ day: 7, start: "01:15", end: "02:30" }],
    }),
    [],
    now,
  );
  assert.equal(p.entries[0]!.start, null);
  assert.ok(p.assumptions.some((x) => x.includes("ambiguous")));
  assert.throws(() =>
    planningPreferences.parse({
      windows: [
        { day: 1, start: "09:00", end: "12:00" },
        { day: 1, start: "10:00", end: "13:00" },
      ],
    }),
  );
});
