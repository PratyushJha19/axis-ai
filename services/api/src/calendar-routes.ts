import { Router } from "express";
import { z } from "zod";
import { CalendarService } from "../../../packages/domain/src/calendar.js";
import { dayRange } from "../../../packages/domain/src/planning-engine.js";
import { sql } from "kysely";
const range = z
  .object({
    date: z.iso.date(),
    days: z.coerce.number().int().min(1).max(31).default(7),
  })
  .strict();
export function calendarRouter(svc: CalendarService, origin: string) {
  const r = Router();
  r.get("/calendar/status", async (_q, s) =>
    s.json(await svc.view(s.locals.user.id)),
  );
  r.post("/calendar/connect", async (q, s) => {
    z.object({ consent: z.literal(true) })
      .strict()
      .parse(q.body);
    s.json(await svc.begin(s.locals.user.id, q.sessionID));
  });
  r.get("/calendar/callback", async (q, s) => {
    try {
      await svc.callback(
        s.locals.user.id,
        q.sessionID,
        new URL(q.originalUrl, origin),
        s.locals.requestId,
      );
      s.redirect("/?calendar=connected");
    } catch {
      s.redirect("/?calendar=failed");
    }
  });
  r.post("/calendar/sync", async (q, s) => {
    const v = range.parse(q.body);
    s.json(
      await svc.sync(s.locals.user.id, v.date, v.days, s.locals.requestId),
    );
  });
  r.get("/calendar/events", async (q, s) => {
    const v = range.parse(q.query);
    const p = (
      await sql<{
        timezone: string;
      }>`select timezone from users where id=${s.locals.user.id}`.execute(
        svc.db,
      )
    ).rows[0]!;
    const d = dayRange(v.date, p.timezone || "UTC", v.days);
    s.json(await svc.view(s.locals.user.id, d.start, d.end));
  });
  r.post("/calendar/disconnect", async (q, s) => {
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(q.body);
    s.json(await svc.disconnect(s.locals.user.id, s.locals.requestId));
  });
  return r;
}
