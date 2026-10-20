import { Temporal } from "@js-temporal/polyfill";
import type {
  PlanningTask,
  RankedTask,
  PlanningPreferences,
  PlanDocument,
} from "../../shared/src/planning.js";
import { localToUtc } from "./reminder-time.js";
import { DomainError } from "./errors.js";
export type Interval = { start: string; end: string };
export const localDate = (now: Date, zone: string) =>
  Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
export function weekStart(date: string, first = 1) {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: (d.dayOfWeek - first + 7) % 7 }).toString();
}
export function dayRange(date: string, zone: string, days = 1) {
  const d = Temporal.PlainDate.from(date);
  return {
    start: new Date(d.toZonedDateTime(zone).epochMilliseconds),
    end: new Date(d.add({ days }).toZonedDateTime(zone).epochMilliseconds),
  };
}
export function rankTasks(tasks: PlanningTask[], now: Date): RankedTask[] {
  return tasks
    .filter((t) => !["completed", "cancelled"].includes(t.status))
    .map((t) => {
      const hours = t.due_at
        ? (Date.parse(t.due_at) - now.getTime()) / 3600000
        : null;
      const reasons = [`${t.priority} priority`];
      let urgency = 0;
      if (hours !== null) {
        if (hours < 0) {
          urgency = 80;
          reasons.push("Past its recorded due time");
        } else if (hours <= 24) {
          urgency = 50;
          reasons.push("Due within 24 hours");
        } else if (hours <= 168) {
          urgency = 20;
          reasons.push("Due within seven days");
        }
      } else reasons.push("No due date recorded");
      if (t.status === "blocked" || t.status === "deferred")
        reasons.push(`${t.status}; review before scheduling`);
      if (t.estimated_minutes === null) reasons.push("No duration estimate");
      return {
        ...t,
        reasons,
        score:
          { low: 0, normal: 20, high: 40, critical: 60 }[t.priority] + urgency,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999") ||
        a.id.localeCompare(b.id),
    );
}
export function availability(
  date: string,
  days: number,
  zone: string,
  prefs: PlanningPreferences,
) {
  const windows: Interval[] = [];
  const warnings: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = Temporal.PlainDate.from(date).add({ days: i });
    for (const w of prefs.windows.filter((w) => w.day === d.dayOfWeek))
      try {
        windows.push({
          start: localToUtc(`${d}T${w.start}`, zone).toISOString(),
          end: localToUtc(`${d}T${w.end}`, zone).toISOString(),
        });
      } catch {
        warnings.push(
          `Availability on ${d} crosses an ambiguous or invalid local time; edit it.`,
        );
      }
  }
  return {
    windows: windows.sort((a, b) => a.start.localeCompare(b.start)),
    warnings,
  };
}
const overlap = (a: Interval, b: Interval, buffer = 0) =>
  Date.parse(a.start) < Date.parse(b.end) + buffer &&
  Date.parse(b.start) < Date.parse(a.end) + buffer;
export function buildPlan(
  tasks: PlanningTask[],
  date: string,
  kind: "daily" | "weekly",
  mode: "priority" | "timeblock",
  zone: string,
  prefs: PlanningPreferences,
  blocked: Interval[],
  now: Date,
): PlanDocument {
  const { windows, warnings } = availability(
      date,
      kind === "daily" ? 1 : 7,
      zone,
      prefs,
    ),
    busy = [...blocked],
    buffer = prefs.buffer_minutes * 60000;
  const entries: PlanDocument["entries"] = [];
  for (const t of tasks) {
    let start: string | null = null,
      end: string | null = null;
    let reason =
      mode === "priority"
        ? "Priority list; no time reserved"
        : "Does not fit before its deadline or available capacity";
    if (["blocked", "deferred"].includes(t.status))
      reason = `${t.status}; review before scheduling`;
    else if (t.estimated_minutes === null)
      reason = "Missing estimate; left unscheduled";
    else if (mode === "timeblock") {
      const duration = t.estimated_minutes * 60000;
      outer: for (const w of windows) {
        let cursor = Math.max(
          Date.parse(w.start),
          Math.ceil(now.getTime() / 60000) * 60000,
        );
        while (
          cursor + duration <= Date.parse(w.end) &&
          (!t.due_at || cursor + duration <= Date.parse(t.due_at))
        ) {
          const candidate = {
            start: new Date(cursor).toISOString(),
            end: new Date(cursor + duration).toISOString(),
          };
          const conflicts = busy.filter((b) => overlap(candidate, b, buffer));
          if (!conflicts.length) {
            start = candidate.start;
            end = candidate.end;
            busy.push(candidate);
            reason =
              "Fits explicit availability, estimate and recorded deadline";
            break outer;
          }
          cursor = Math.max(
            ...conflicts.map((b) => Date.parse(b.end) + buffer),
          );
        }
      }
    }
    entries.push({
      task_id: t.id,
      task_version: t.version,
      start,
      end,
      reason,
    });
  }
  return {
    date,
    kind,
    mode,
    timezone: zone,
    entries,
    assumptions: [
      "Uses configured availability, recorded blocks and available cached Calendar busy periods.",
      ...(!windows.length
        ? ["No working availability configured; tasks remain unscheduled."]
        : []),
      ...warnings,
    ].slice(0, 20),
  };
}
export function validatePlan(
  doc: PlanDocument,
  tasks: PlanningTask[],
  prefs: PlanningPreferences,
  blocked: Interval[],
  now: Date,
) {
  const { windows } = availability(
      doc.date,
      doc.kind === "daily" ? 1 : 7,
      doc.timezone,
      prefs,
    ),
    seen = new Set<string>(),
    busy = [...blocked],
    buffer = prefs.buffer_minutes * 60000;
  for (const e of doc.entries) {
    const t = tasks.find((t) => t.id === e.task_id);
    if (!t)
      throw new DomainError(
        "NOT_FOUND",
        404,
        "A plan task is no longer available.",
      );
    if (t.version !== e.task_version)
      throw new DomainError(
        "STALE_PLAN",
        409,
        "A task changed. Generate a fresh plan before accepting.",
      );
    if (seen.has(t.id) || ["completed", "cancelled"].includes(t.status))
      throw new DomainError(
        "INVALID_PLAN",
        422,
        "Plan contains a duplicate or finished task.",
      );
    seen.add(t.id);
    if (e.start && e.end) {
      const interval = { start: e.start, end: e.end },
        s = Date.parse(e.start),
        end = Date.parse(e.end);
      if (
        doc.mode !== "timeblock" ||
        ["blocked", "deferred"].includes(t.status) ||
        !t.estimated_minutes ||
        end - s !== t.estimated_minutes * 60000 ||
        s < now.getTime() ||
        (t.due_at && end > Date.parse(t.due_at)) ||
        !windows.some(
          (w) => s >= Date.parse(w.start) && end <= Date.parse(w.end),
        ) ||
        busy.some((b) => overlap(interval, b, buffer))
      )
        throw new DomainError(
          "PLAN_CONFLICT",
          409,
          "A block conflicts with availability, estimates, deadlines or existing commitments.",
        );
      busy.push(interval);
    }
  }
}
