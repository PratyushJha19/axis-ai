import { z } from "zod";

export const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone.");
const name = z.string().trim().min(1).max(120);
const projectId = z.uuid().nullable().default(null);
export const projectSchema = z
  .object({
    name,
    description: z.string().trim().max(3000).default(""),
    status: z
      .enum(["active", "paused", "archived", "completed"])
      .default("active"),
  })
  .strict();
export const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).default(""),
    status: z
      .enum([
        "inbox",
        "planned",
        "in_progress",
        "blocked",
        "completed",
        "cancelled",
        "deferred",
      ])
      .default("inbox"),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
    project_id: projectId,
    due_at: z.iso.datetime({ offset: true }).nullable().default(null),
    due_timezone: timezoneSchema.nullable().default(null),
    estimated_minutes: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .nullable()
      .default(null),
    archived: z.boolean().default(false),
  })
  .strict()
  .refine(
    (t) => (t.due_at === null) === (t.due_timezone === null),
    "A due time needs a timezone.",
  );
export const memorySchema = z
  .object({
    content: z.string().trim().min(1).max(10000),
    project_id: projectId,
    kind: z
      .enum([
        "preference",
        "fact",
        "decision",
        "context",
        "routine",
        "relationship",
        "other",
      ])
      .default("fact"),
    scope: z.enum(["global", "project"]).default("global"),
    truth_status: z
      .enum(["confirmed", "assumed", "suggested"])
      .default("confirmed"),
    sensitivity: z.enum(["ordinary", "sensitive"]),
    consent: z.boolean().default(false),
    archived: z.boolean().default(false),
  })
  .strict()
  .refine(
    (m) => (m.scope === "project") === (m.project_id !== null),
    "Select a project for project memory.",
  );
export const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(30),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    q: z.string().trim().max(200).default(""),
    archived: z.enum(["false", "true", "all"]).default("false"),
    project_id: z.uuid().optional(),
  })
  .strict();

export interface Profile {
  id: string;
  display_name: string;
  email: string;
  timezone: string | null;
}
export interface BaseRecord {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  version: number;
}
export interface Project extends BaseRecord, z.infer<typeof projectSchema> {}
export interface Task
  extends BaseRecord, Omit<z.infer<typeof taskSchema>, "archived"> {
  archived_at: string | null;
  completion_at: string | null;
}
export interface Memory
  extends
    BaseRecord,
    Omit<z.infer<typeof memorySchema>, "consent" | "archived"> {
  archived_at: string | null;
  save_consent_at: string | null;
  source_type: "user";
}
export interface RowMap {
  projects: Project;
  tasks: Task;
  memory_items: Memory;
}
export type Table = keyof RowMap;
export type ListInput = z.infer<typeof listSchema>;
