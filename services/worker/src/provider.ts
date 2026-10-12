import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../../packages/database/src/index.js";
import type { Reminder } from "../../../packages/shared/src/reminders.js";

export const outcomeSchema = z
  .object({
    status: z.enum(["delivered", "sent", "unknown", "failed", "not_found"]),
    messageId: z.uuid().optional(),
    category: z
      .enum([
        "transient",
        "permanent",
        "configuration",
        "rate_limit",
        "unknown",
      ])
      .optional(),
    retryAfterMs: z.number().int().min(0).max(86400000).optional(),
  })
  .strict();
export type Outcome = z.infer<typeof outcomeSchema>;
export interface NotificationProvider {
  readonly name: "mock" | "outbox";
  send(
    input: { key: string; title: string; body: string; reminder?: Reminder },
    signal: AbortSignal,
  ): Promise<Outcome>;
  reconcile(key: string, signal: AbortSignal): Promise<Outcome>;
}
export function mockProvider(db: Kysely<Database>): NotificationProvider {
  return {
    name: "mock",
    async send(input) {
      const result = await sql<{
        provider_message_id: string;
      }>`insert into mock_notification_receipts(idempotency_key,provider_message_id) values (${input.key},${randomUUID()}) on conflict(idempotency_key) do update set idempotency_key=excluded.idempotency_key returning provider_message_id`.execute(
        db,
      );
      return {
        status: "delivered",
        messageId: result.rows[0]!.provider_message_id,
      };
    },
    async reconcile(key) {
      const result = await sql<{
        provider_message_id: string;
      }>`select provider_message_id from mock_notification_receipts where idempotency_key=${key}`.execute(
        db,
      );
      return result.rows[0]
        ? { status: "delivered", messageId: result.rows[0].provider_message_id }
        : { status: "not_found" };
    },
  };
}
export async function boundedProviderCall(
  call: (signal: AbortSignal) => Promise<Outcome>,
  timeoutMs: number,
): Promise<Outcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return outcomeSchema.parse(
      await Promise.race([
        call(controller.signal),
        new Promise<Outcome>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve({ status: "unknown", category: "unknown" });
          }, timeoutMs);
        }),
      ]),
    );
  } catch {
    // Exceptions and malformed responses do not prove non-delivery. Never expose provider payloads.
    return { status: "unknown", category: "unknown" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
