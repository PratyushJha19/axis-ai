import { z } from "zod";
import { localTimeSchema } from "./reminders.js";

// Models can draft these two local operations only; never an owner, recipient or consent.
export const chatDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("task"),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000).default(""),
      local_due: localTimeSchema.nullable().default(null),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reminder"),
      title: z.string().trim().min(1).max(200),
      body: z.string().trim().max(1000).default(""),
      local_due: localTimeSchema,
      recurrence: z.enum(["none", "daily", "weekly"]).default("none"),
    })
    .strict(),
]);
export const chatEnvelopeSchema = z
  .object({
    reply: z.string().trim().min(1).max(16000),
    proposal: chatDraftSchema.nullable(),
  })
  .strict();
export type ChatDraft = z.infer<typeof chatDraftSchema>;
// Narrow internal changes use the same immutable approval ledger as creation.
// The model chat envelope intentionally continues to accept creation only.
export const changeDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("task"),
      title: z.string().trim().min(1).max(200),
      description: z.string().max(1000).default(""),
      local_due: z.null(),
      change: z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          operation: z.enum(["rename", "complete"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reminder"),
      title: z.string().trim().min(1).max(200),
      body: z.string().max(1000).default(""),
      local_due: localTimeSchema.nullable(),
      recurrence: z.enum(["none", "daily", "weekly"]),
      change: z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          operation: z.enum(["cancel", "reschedule"]),
        })
        .strict(),
    })
    .strict()
    .refine(
      (v) => (v.change.operation === "reschedule") === (v.local_due !== null),
    ),
]);
export const approvalDraftSchema = z.union([
  chatDraftSchema,
  changeDraftSchema,
]);
export function approvalType(payload: z.infer<typeof approvalDraftSchema>) {
  return `${payload.kind}.${"change" in payload ? payload.change.operation : "create"}`;
}
export type ChatAction = {
  id: string;
  request_id: string;
  conversation_id: string;
  payload: z.infer<typeof approvalDraftSchema> & {
    timezone: string | null;
    due_at: string | null;
  };
  payload_hash: string;
  status:
    | "pending"
    | "approved"
    | "executing"
    | "succeeded"
    | "rejected"
    | "expired"
    | "cancelled"
    | "failed"
    | "unknown";
  entity_id: string | null;
  expires_at: string;
};
