import assert from "node:assert/strict";
import test from "node:test";
import {
  googleCalendarProvider,
  normalizeCalendarPage,
  calendarScope,
} from "../../packages/domain/src/calendar-provider.js";
import {
  dayRange,
  weekStart,
} from "../../packages/domain/src/planning-engine.js";
test("Calendar normalizes DST all-day, cross-midnight, transparent and cancelled events", () => {
  const p = normalizeCalendarPage({
    timeZone: "America/New_York",
    items: [
      { id: "all", start: { date: "2026-03-08" }, end: { date: "2026-03-09" } },
      {
        id: "cross",
        start: { dateTime: "2026-03-08T23:30:00-04:00" },
        end: { dateTime: "2026-03-09T00:30:00-04:00" },
        transparency: "transparent",
      },
      { id: "gone", status: "cancelled" },
    ],
  });
  assert.equal(p.events.length, 2);
  assert.equal(
    Date.parse(p.events[0]!.end) - Date.parse(p.events[0]!.start),
    23 * 3600000,
  );
  assert.equal(p.events[1]!.busy, false);
  const range = dayRange("2026-03-08", "America/New_York");
  assert.equal(+range.end - +range.start, 23 * 3600000);
  assert.equal(weekStart("2026-10-22", 1), "2026-10-19");
});
test("Calendar adapter refreshes, paginates expanded recurrences and never calls event writes", async () => {
  const calls: { url: string; method: string }[] = [];
  const provider = googleCalendarProvider(
    {
      origin: "http://localhost:3000",
      clientId: "fixture",
      clientSecret: "fixture",
    },
    async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method || "GET" });
      if (url.endsWith("/token"))
        return Response.json({
          access_token: "synthetic-access",
          scope: calendarScope,
        });
      const next = new URL(url).searchParams.has("pageToken");
      return Response.json({
        timeZone: "UTC",
        ...(!next ? { nextPageToken: "next" } : {}),
        items: [
          {
            id: next ? "series_2" : "series_1",
            start: { dateTime: "2026-10-20T09:00:00Z" },
            end: { dateTime: "2026-10-20T10:00:00Z" },
          },
        ],
      });
    },
  );
  assert.equal(
    (
      await provider.events(
        "fixture",
        "2026-10-20T00:00:00Z",
        "2026-10-27T00:00:00Z",
      )
    ).length,
    2,
  );
  assert.equal(calls.length, 3);
  assert.ok(
    calls
      .slice(1)
      .every((c) => c.method === "GET" && c.url.includes("singleEvents=true")),
  );
});
test("Calendar adapter classifies revoked access, rate limiting and missing scope without raw errors", async () => {
  for (const [status, code] of [
    [400, "reauthorize"],
    [401, "reauthorize"],
    [403, "reauthorize"],
    [429, "rate_limited"],
    [503, "provider_failure"],
  ] as const) {
    const p = googleCalendarProvider(
      {
        origin: "http://localhost:3000",
        clientId: "fixture",
        clientSecret: "fixture",
      },
      async () => new Response("private-error", { status }),
    );
    await assert.rejects(
      p.events("fixture", "a", "b"),
      (e) => e instanceof Error && e.message === code,
    );
  }
});
