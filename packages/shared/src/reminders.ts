import { z } from "zod";
import { timezoneSchema } from "./contracts.js";

export const localTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
export const scheduleSchema = z
  .object({
    local_due: localTimeSchema,
    timezone: timezoneSchema,
    disambiguation: z.enum(["reject", "earlier", "later"]).default("reject"),
  })
  .strict();
export const reminderSchema = scheduleSchema.extend({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).default(""),
  task_id: z.uuid().nullable().default(null),
  project_id: z.uuid().nullable().default(null),
  recurrence: z.enum(["none", "daily", "weekly"]).default("none"),
  confirmed: z.literal(true),
});
export const reminderListSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
const wallTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const preferenceSchema = z
  .object({
    quiet_start: wallTime.nullable(),
    quiet_end: wallTime.nullable(),
    focus_blocks: z
      .array(
        z
          .object({
            start: z.iso.datetime({ offset: true }),
            end: z.iso.datetime({ offset: true }),
          })
          .strict()
          .refine(
            (b) => Date.parse(b.end) > Date.parse(b.start),
            "Focus end must follow start.",
          ),
      )
      .max(100),
  })
  .strict()
  .refine(
    (v) =>
      (v.quiet_start === null) === (v.quiet_end === null) &&
      (v.quiet_start === null || v.quiet_start !== v.quiet_end),
    "Quiet hours need distinct start and end times.",
  );
export type ReminderInput = z.infer<typeof reminderSchema>;
export type Preferences = z.infer<typeof preferenceSchema>;
export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  body: string;
  task_id: string | null;
  project_id: string | null;
  due_at: string;
  local_due: string;
  timezone: string;
  recurrence: ReminderInput["recurrence"];
  disambiguation: ReminderInput["disambiguation"];
  status:
    | "scheduled"
    | "processing"
    | "sent"
    | "delivered"
    | "failed"
    | "unknown"
    | "cancelled"
    | "snoozed";
  occurrence: number;
  skipped_count: number;
  send_count: number;
  reconcile_count: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  lease_token: string | null;
  lease_until: string | null;
  attention: boolean;
  reason: string | null;
  version: number;
  idempotency_key: string;
  correlation_id: string;
  channel_policy: "mock_only" | "whatsapp_email";
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface Attempt {
  id: string;
  reminder_id: string;
  user_id: string;
  occurrence: number;
  occurrence_due_at: string;
  channel: "mock" | "notification" | "whatsapp" | "email";
  provider: "mock" | "outbox" | "twilio" | "resend";
  status:
    | "sending"
    | "sent"
    | "delivered"
    | "failed"
    | "unknown"
    | "suppressed"
    | "accepted"
    | "read"
    | "undelivered"
    | "blocked";
  attempt_number: number;
  idempotency_key: string;
  provider_message_id: string | null;
  error_category: string | null;
  started_at: string;
  finished_at: string | null;
}
