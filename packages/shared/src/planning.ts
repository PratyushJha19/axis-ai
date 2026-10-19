import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
export const planDate = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}$/)
  .refine((v) => {
    try {
      Temporal.PlainDate.from(v, { overflow: "reject" });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid date.");
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const planningPreferences = z
  .object({
    windows: z
      .array(
        z
          .object({
            day: z.number().int().min(1).max(7),
            start: clock,
            end: clock,
          })
          .strict()
          .refine(
            (w) => w.end > w.start,
            "Availability must end after it starts.",
          ),
      )
      .max(21)
      .default([]),
    first_day: z.number().int().min(1).max(7).default(1),
    buffer_minutes: z.number().int().min(0).max(60).default(10),
    alerts_enabled: z.boolean().default(false),
    lead_minutes: z.number().int().min(5).max(10080).default(60),
    briefing_time: clock.nullable().default(null),
  })
  .strict()
  .refine(
    (p) =>
      !p.windows.some((w, i) =>
        p.windows.some(
          (v, j) =>
            i !== j && w.day === v.day && w.start < v.end && v.start < w.end,
        ),
      ),
    "Availability windows cannot overlap.",
  );
export type PlanningPreferences = z.infer<typeof planningPreferences>;
export const planEntry = z
  .object({
    task_id: z.uuid(),
    task_version: z.number().int().positive(),
    start: z.iso.datetime({ offset: true }).nullable(),
    end: z.iso.datetime({ offset: true }).nullable(),
    reason: z.string().max(300),
  })
  .strict()
  .refine((v) => (v.start === null) === (v.end === null));
export const planDocument = z
  .object({
    date: planDate,
    kind: z.enum(["daily", "weekly"]),
    mode: z.enum(["priority", "timeblock"]),
    timezone: z.string().max(100),
    entries: z.array(planEntry).max(100),
    assumptions: z.array(z.string().max(300)).max(20),
  })
  .strict();
export type PlanDocument = z.infer<typeof planDocument>;
export interface Plan {
  id: string;
  version: number;
  status: "draft" | "accepted" | "discarded";
  document: PlanDocument;
  created_at: string;
  updated_at: string;
  algorithm_version: string;
}
export interface PlanningTask {
  id: string;
  title: string;
  status: string;
  priority: "low" | "normal" | "high" | "critical";
  due_at: string | null;
  estimated_minutes: number | null;
  project_id: string | null;
  version: number;
  completion_at: string | null;
  updated_at: string;
}
export interface RankedTask extends PlanningTask {
  reasons: string[];
  score: number;
}
export interface Briefing {
  date: string;
  timezone: string;
  week_start: string;
  fingerprint: string;
  priorities: RankedTask[];
  due_today: PlanningTask[];
  overdue: PlanningTask[];
  upcoming: PlanningTask[];
  projects: {
    id: string;
    name: string;
    open: number;
    overdue: number;
    blocked: number;
  }[];
  reminders: { id: string; title: string; due_at: string; status: string }[];
  completed: PlanningTask[];
  limited: boolean;
  missing: string[];
  recommendations: { task_id: string; advice: string }[];
  ai_status: string;
}
export const generationInput = z
  .object({
    idempotency_key: z.uuid(),
    date: planDate,
    kind: z.enum(["daily", "weekly"]),
    mode: z.enum(["priority", "timeblock"]),
    task_ids: z.array(z.uuid()).max(100).optional(),
  })
  .strict();
export const recommendationsSchema = z
  .object({
    recommendations: z
      .array(
        z
          .object({
            task_id: z.uuid(),
            advice: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();
