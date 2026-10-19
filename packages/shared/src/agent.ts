import { z } from "zod";
export const agentInput = z
  .object({
    idempotency_key: z.uuid(),
    goal: z.string().trim().min(1).max(4000),
    conversation_id: z.uuid().optional(),
    consent: z.literal(true),
  })
  .strict();
export const agentDecision = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("final"),
      message: z.string().trim().min(1).max(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("clarify"),
      message: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tools"),
      calls: z
        .array(
          z
            .object({
              name: z.string().min(1).max(80),
              arguments: z.record(z.string(), z.unknown()),
            })
            .strict(),
        )
        .min(1)
        .max(4),
    })
    .strict(),
]);
export type AgentDecision = z.infer<typeof agentDecision>;
export type AgentRun = {
  id: string;
  goal: string;
  status: string;
  answer: string | null;
  error_code: string | null;
  waiting_for_proposal_id: string | null;
  iterations: number;
  tool_count: number;
  created_at: string;
};
export type AgentCall = {
  id: string;
  tool_id: string;
  status: string;
  result: unknown;
  proposal_id: string | null;
};
