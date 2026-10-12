import { Temporal } from "@js-temporal/polyfill";
import type { Preferences, ReminderInput } from "../../shared/src/reminders.js";
import { DomainError } from "./errors.js";

export function localToUtc(
  local: string,
  zone: string,
  disambiguation: ReminderInput["disambiguation"] = "reject",
) {
  try {
    const plain = Temporal.PlainDateTime.from(local, { overflow: "reject" });
    if (plain.year < 2000 || plain.year > 2100) throw new Error();
    return new Date(
      plain.toZonedDateTime(zone, { disambiguation }).epochMilliseconds,
    );
  } catch {
    throw new DomainError(
      "AMBIGUOUS_TIME",
      422,
      "Invalid or ambiguous local time. Choose a valid date and an explicit earlier/later DST interpretation if needed.",
    );
  }
}

export function nextOccurrence(
  local: string,
  zone: string,
  recurrence: "daily" | "weekly",
  disambiguation: ReminderInput["disambiguation"],
  now: Date,
) {
  const step = recurrence === "daily" ? 1 : 7;
  const original = Temporal.PlainDateTime.from(local);
  const today = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(zone)
    .toPlainDate();
  const days = original
    .toPlainDate()
    .until(today, { largestUnit: "days" }).days;
  let increment = Math.max(1, Math.floor(days / step));
  let candidate = original.add({ days: increment * step });
  let due = localToUtc(
    candidate.toString({ smallestUnit: "minute" }),
    zone,
    disambiguation,
  );
  while (due.getTime() <= now.getTime()) {
    increment++;
    candidate = original.add({ days: increment * step });
    due = localToUtc(
      candidate.toString({ smallestUnit: "minute" }),
      zone,
      disambiguation,
    );
  }
  return {
    local: candidate.toString({ smallestUnit: "minute" }),
    due,
    skipped: increment - 1,
  };
}

export function deferredUntil(
  now: Date,
  zone: string,
  preferences: Preferences,
): Date | null {
  let candidate = now;
  // Each iteration exits a quiet window or one focus block. Bounded by the schema's 100 blocks.
  for (let n = 0; n < 205; n++) {
    let end = candidate.getTime();
    const zoned =
      Temporal.Instant.fromEpochMilliseconds(end).toZonedDateTimeISO(zone);
    const { quiet_start: start, quiet_end: finish } = preferences;
    if (start && finish) {
      // Compare instants, not just wall times: a repeated hour must stay quiet
      // until the later end boundary, even between the two appearances of it.
      for (const days of [-1, 0]) {
        const day = zoned.toPlainDate().add({ days });
        const begins = day.toPlainDateTime(start).toZonedDateTime(zone, {
          disambiguation: "earlier",
        }).epochMilliseconds;
        const ends = day
          .add({ days: start > finish ? 1 : 0 })
          .toPlainDateTime(finish)
          .toZonedDateTime(zone, { disambiguation: "later" }).epochMilliseconds;
        if (candidate.getTime() >= begins && candidate.getTime() < ends)
          end = Math.max(end, ends);
      }
    }
    for (const block of preferences.focus_blocks) {
      if (
        Date.parse(block.start) <= candidate.getTime() &&
        Date.parse(block.end) > candidate.getTime()
      )
        end = Math.max(end, Date.parse(block.end));
    }
    if (end === candidate.getTime())
      return end > now.getTime() ? candidate : null;
    candidate = new Date(end);
  }
  throw new DomainError(
    "SCHEDULE_BLOCKED",
    422,
    "Review overlapping quiet hours and focus blocks.",
  );
}
