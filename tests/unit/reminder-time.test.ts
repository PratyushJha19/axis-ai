import assert from "node:assert/strict";
import test from "node:test";
import {
  localToUtc,
  nextOccurrence,
  deferredUntil,
} from "../../packages/domain/src/reminder-time.js";
import {
  reminderSchema,
  preferenceSchema,
} from "../../packages/shared/src/reminders.js";
import { retryDelay, workerPolicy } from "../../services/worker/src/engine.js";
import { boundedProviderCall } from "../../services/worker/src/provider.js";

test("owner wall time converts to UTC and ambiguous/invalid times need explicit interpretation", () => {
  assert.equal(
    localToUtc("2026-10-11T09:00", "Asia/Kolkata").toISOString(),
    "2026-10-11T03:30:00.000Z",
  );
  assert.throws(() => localToUtc("2026-02-30T09:00", "UTC"));
  assert.throws(() => localToUtc("2026-03-08T02:30", "America/New_York"));
  assert.throws(() => localToUtc("2026-11-01T01:30", "America/New_York"));
  assert.equal(
    localToUtc("2026-11-01T01:30", "America/New_York", "earlier").toISOString(),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(
    localToUtc("2026-11-01T01:30", "America/New_York", "later").toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
});
test("daily and weekly recurrence preserve wall clock through DST and skip missed repeats", () => {
  const spring = nextOccurrence(
    "2026-03-07T09:00",
    "America/New_York",
    "daily",
    "reject",
    new Date("2026-03-07T14:01Z"),
  );
  assert.equal(spring.due.toISOString(), "2026-03-08T13:00:00.000Z");
  const fall = nextOccurrence(
    "2026-10-25T09:00",
    "America/New_York",
    "weekly",
    "reject",
    new Date("2026-10-25T14:00Z"),
  );
  assert.equal(fall.due.toISOString(), "2026-11-01T14:00:00.000Z");
  const overdue = nextOccurrence(
    "2026-10-01T09:00",
    "UTC",
    "daily",
    "reject",
    new Date("2026-10-05T12:00Z"),
  );
  assert.equal(overdue.local, "2026-10-06T09:00");
  assert.equal(overdue.skipped, 4);
});
test("overnight quiet hours, focus chaining and DST endings defer without deleting", () => {
  const pref = {
    quiet_start: "22:00",
    quiet_end: "07:00",
    focus_blocks: [
      { start: "2026-10-12T01:30:00Z", end: "2026-10-12T02:30:00Z" },
    ],
  };
  assert.equal(
    deferredUntil(
      new Date("2026-10-11T18:00Z"),
      "Asia/Kolkata",
      pref,
    )?.toISOString(),
    "2026-10-12T02:30:00.000Z",
  );
  assert.equal(
    deferredUntil(new Date("2026-10-12T02:30Z"), "Asia/Kolkata", pref),
    null,
  );
  assert.equal(
    deferredUntil(new Date("2026-11-01T05:15Z"), "America/New_York", {
      quiet_start: "00:00",
      quiet_end: "01:30",
      focus_blocks: [],
    })?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
});
test("strict reminder contracts reject owner injection, missing confirmation and invalid blocks", () => {
  const input = {
    title: "Test",
    local_due: "2026-10-11T09:00",
    timezone: "UTC",
    confirmed: true,
  };
  assert.equal(reminderSchema.safeParse(input).success, true);
  assert.equal(
    reminderSchema.safeParse({ ...input, user_id: "injected" }).success,
    false,
  );
  assert.equal(
    reminderSchema.safeParse({ ...input, confirmed: false }).success,
    false,
  );
  assert.equal(
    preferenceSchema.safeParse({
      quiet_start: "22:00",
      quiet_end: null,
      focus_blocks: [],
    }).success,
    false,
  );
});
test("quiet hours span both appearances of a repeated DST end time", () => {
  assert.equal(
    deferredUntil(new Date("2026-11-01T05:45Z"), "America/New_York", {
      quiet_start: "00:00",
      quiet_end: "01:30",
      focus_blocks: [],
    })?.toISOString(),
    "2026-11-01T06:30:00.000Z",
  );
});
test("retry backoff is bounded and provider exceptions/timeouts remain unknown", async () => {
  const policy = workerPolicy({});
  assert.equal(
    retryDelay(1, policy, () => 0.5),
    30000,
  );
  assert.equal(
    retryDelay(2, policy, () => 0.5),
    60000,
  );
  assert.equal(
    retryDelay(99, policy, () => 1),
    900000,
  );
  assert.throws(() =>
    workerPolicy({ REMINDER_LEASE_MS: "1000", REMINDER_TIMEOUT_MS: "1000" }),
  );
  assert.equal(
    (
      await boundedProviderCall(async () => {
        throw new Error("synthetic-private");
      }, 10)
    ).status,
    "unknown",
  );
  assert.equal(
    (await boundedProviderCall(() => new Promise(() => {}), 5)).status,
    "unknown",
  );
});
