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
export type ChatAction = {
  id: string;
  request_id: string;
  conversation_id: string;
  payload: ChatDraft & { timezone: string | null; due_at: string | null };
  payload_hash: string;
  status: "pending" | "succeeded" | "rejected" | "expired";
  entity_id: string | null;
  expires_at: string;
};
