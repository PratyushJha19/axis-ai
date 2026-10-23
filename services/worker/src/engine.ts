import { randomUUID } from "node:crypto";
import { planningAlertAllowed } from "../../../packages/domain/src/planning-alert-policy.js";
import { taskDeadlineAllowed } from "../../../packages/domain/src/task-deadline-policy.js";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Logger } from "pino";
import type { Database } from "../../../packages/database/src/index.js";
import type {
  Reminder,
  Attempt,
} from "../../../packages/shared/src/reminders.js";
import {
  getReminder,
  getPreferences,
} from "../../../packages/domain/src/reminders.js";
import {
  deferredUntil,
  nextOccurrence,
} from "../../../packages/domain/src/reminder-time.js";
import { audit } from "../../../packages/domain/src/records.js";
import {
  boundedProviderCall,
  type NotificationProvider,
  type Outcome,
} from "./provider.js";

const policySchema = z
  .object({
    leaseMs: z.number().int().min(1000).max(300000).default(60000),
    timeoutMs: z.number().int().min(1).max(30000).default(5000),
    maxAttempts: z.number().int().min(1).max(10).default(3),
    maxReconciliations: z.number().int().min(1).max(10).default(3),
    retryBaseMs: z.number().int().min(1).max(900000).default(30000),
    retryCapMs: z.number().int().min(1).max(900000).default(900000),
  })
  .refine((v) => v.leaseMs > v.timeoutMs * 2 && v.retryCapMs >= v.retryBaseMs);
export function workerPolicy(env: NodeJS.ProcessEnv = process.env) {
  const number = (key: string) => (env[key] ? Number(env[key]) : undefined);
  return policySchema.parse({
    leaseMs: number("REMINDER_LEASE_MS"),
    timeoutMs: number("REMINDER_TIMEOUT_MS"),
    maxAttempts: number("REMINDER_MAX_ATTEMPTS"),
    maxReconciliations: number("REMINDER_MAX_RECONCILIATIONS"),
    retryBaseMs: number("REMINDER_RETRY_BASE_MS"),
    retryCapMs: number("REMINDER_RETRY_CAP_MS"),
  });
}
export type WorkerPolicy = z.infer<typeof policySchema>;
export function retryDelay(
  count: number,
  policy: WorkerPolicy,
  random = Math.random,
) {
  return Math.min(
    policy.retryCapMs,
    Math.round(
      policy.retryBaseMs * 2 ** Math.max(0, count - 1) * (0.8 + 0.4 * random()),
    ),
  );
}
export class ReminderEngine {
  readonly workerId = randomUUID();
  readonly policy: WorkerPolicy;
  constructor(
    readonly db: Kysely<Database>,
    readonly provider: NotificationProvider,
    readonly logger: Logger,
    readonly clock: () => Date = () => new Date(),
    policy: Partial<WorkerPolicy> = {},
    readonly random: () => number = Math.random,
  ) {
    this.policy = policySchema.parse(policy);
  }
  async heartbeat() {
    await sql`insert into worker_heartbeats(id,last_seen_at,mode) values (${this.workerId},${this.clock()},${this.provider.name === "mock" ? "mock_only" : "live"}) on conflict(id) do update set last_seen_at=excluded.last_seen_at`.execute(
      this.db,
    );
  }
  async claim(): Promise<Reminder | null> {
    const now = this.clock();
    const result = await sql<Reminder>`with candidate as (
      select id from reminders where next_attempt_at <= ${now} and status not in ('cancelled','delivered') and (${this.provider.name !== "mock"} or channel_policy='mock_only') and (lease_until is null or lease_until <= ${now})
      order by next_attempt_at,id for update skip locked limit 1
    ) update reminders r set lease_token=${randomUUID()},lease_until=${new Date(now.getTime() + this.policy.leaseMs)}
      from candidate c where r.id=c.id returning r.*`.execute(this.db);
    return result.rows[0] || null;
  }
  async prepare(
    claim: Reminder,
  ): Promise<{ row: Reminder; attempt: Attempt; reconcile: boolean } | null> {
    return this.db.transaction().execute(async (trx) => {
      // Serialize preferences/profile changes with the dispatch boundary.
      const owner = await sql<{
        timezone: string | null;
      }>`select timezone from users where id=${claim.user_id} for update`.execute(
        trx,
      );
      const row = await getReminder(trx, claim.user_id, claim.id, true);
      const now = this.clock();
      if (
        row.lease_token !== claim.lease_token ||
        !row.lease_until ||
        new Date(row.lease_until) <= now ||
        row.status === "cancelled"
      )
        return null;
      const latest =
        await sql<Attempt>`select * from notification_attempts where reminder_id=${row.id} and user_id=${row.user_id} and occurrence=${row.occurrence} and job_id is null order by attempt_number desc limit 1`.execute(
          trx,
        );
      const previous = latest.rows[0];
      if (
        previous &&
        ["sending", "sent", "unknown"].includes(previous.status)
      ) {
        await sql`update notification_attempts set status='unknown',error_category='unknown' where id=${previous.id} and status='sending'`.execute(
          trx,
        );
        await sql`update reminders set status='unknown',version=version+1,updated_at=${now} where id=${row.id}`.execute(
          trx,
        );
        return { row, attempt: previous, reconcile: true };
      }
      const preferences = await getPreferences(trx, row.user_id);
      if (
        !(await planningAlertAllowed(trx, row.user_id, row.id, now)) ||
        !(await taskDeadlineAllowed(trx, row.user_id, row.id))
      ) {
        await sql`update reminders set status='cancelled',cancelled_at=${now},next_attempt_at=null,lease_token=null,lease_until=null,version=version+1,reason='planning_source_changed' where id=${row.id}`.execute(
          trx,
        );
        await audit(
          trx,
          row.user_id,
          "planning_alert_suppressed",
          row.id,
          row.correlation_id,
        );
        return null;
      }
      const deferred = deferredUntil(
        now,
        owner.rows[0]?.timezone || row.timezone,
        preferences,
      );
      const attemptNumber = (previous?.attempt_number || 0) + 1;
      const key = `${row.idempotency_key}:${row.occurrence}`;
      const attempt =
        await sql<Attempt>`insert into notification_attempts(id,user_id,reminder_id,occurrence,occurrence_due_at,status,attempt_number,idempotency_key,started_at,finished_at,error_category)
        values (${randomUUID()},${row.user_id},${row.id},${row.occurrence},${row.due_at},${deferred ? "suppressed" : "sending"},${attemptNumber},${key},${now},${deferred ? now : null},${deferred ? "quiet_or_focus" : null}) returning *`.execute(
          trx,
        );
      if (this.provider.name === "outbox") {
        await sql`update notification_attempts set channel='notification',provider='outbox' where id=${attempt.rows[0]!.id}`.execute(
          trx,
        );
        await sql`update reminders set channel_policy='whatsapp_email' where id=${row.id}`.execute(
          trx,
        );
      }
      if (deferred) {
        await sql`update reminders set next_attempt_at=${deferred},status='scheduled',reason='quiet_or_focus',lease_token=null,lease_until=null,version=version+1,updated_at=${now} where id=${row.id}`.execute(
          trx,
        );
        return null;
      }
      if (row.send_count >= this.policy.maxAttempts) {
        // Can occur if retry configuration was tightened while work was queued.
        await sql`update notification_attempts set status='failed',error_category='retry_exhausted',finished_at=${now} where id=${attempt.rows[0]!.id}`.execute(
          trx,
        );
        await sql`update reminders set status='failed',attention=true,reason='retry_exhausted',next_attempt_at=null,lease_token=null,lease_until=null,version=version+1 where id=${row.id}`.execute(
          trx,
        );
        return null;
      }
      await sql`update reminders set status='processing',send_count=send_count+1,last_attempt_at=${now},version=version+1,updated_at=${now} where id=${row.id}`.execute(
        trx,
      );
      await audit(
        trx,
        row.user_id,
        "reminder_dispatch_started",
        row.id,
        row.correlation_id,
      );
      return {
        row: { ...row, send_count: row.send_count + 1 },
        attempt: attempt.rows[0]!,
        reconcile: false,
      };
    });
  }
  async complete(
    work: { row: Reminder; attempt: Attempt; reconcile: boolean },
    outcome: Outcome,
  ) {
    const { row: claimed, attempt, reconcile } = work;
    const result = await this.db.transaction().execute(async (trx) => {
      const row = await getReminder(trx, claimed.user_id, claimed.id, true);
      const now = this.clock();
      if (
        row.lease_token !== claimed.lease_token ||
        !row.lease_until ||
        new Date(row.lease_until) <= now
      )
        return;
      const status = outcome.status === "not_found" ? "failed" : outcome.status;
      const category =
        outcome.status === "not_found"
          ? "transient"
          : outcome.category || (status === "failed" ? "permanent" : null);
      const reconciliations = row.reconcile_count + (reconcile ? 1 : 0);
      let next: Date | null = null,
        attention = false,
        reason: string | null =
          status === "sent" &&
          this.provider.name === "outbox" &&
          outcome.settled
            ? "telegram_sent"
            : null;
      if (status === "failed") {
        if (
          ["transient", "rate_limit"].includes(category || "") &&
          row.send_count < this.policy.maxAttempts
        ) {
          next = new Date(
            now.getTime() +
              Math.max(
                outcome.retryAfterMs || 0,
                retryDelay(row.send_count, this.policy, this.random),
              ),
          );
          reason = "retry_scheduled";
        } else {
          attention = true;
          reason =
            row.send_count >= this.policy.maxAttempts
              ? "retry_exhausted"
              : category;
        }
      } else if (
        status === "unknown" ||
        (status === "sent" &&
          !(this.provider.name === "outbox" && outcome.settled))
      ) {
        attention = reconciliations >= this.policy.maxReconciliations;
        next = attention
          ? null
          : new Date(
              now.getTime() +
                retryDelay(reconciliations + 1, this.policy, this.random),
            );
        reason = attention
          ? "reconciliation_exhausted"
          : "awaiting_reconciliation";
      }
      await sql`update notification_attempts set status=${status},provider_message_id=coalesce(${outcome.messageId || null},provider_message_id),error_category=${category},finished_at=${now} where id=${attempt.id}`.execute(
        trx,
      );
      await sql`update reminders set status=${status},next_attempt_at=${next},attention=${attention},reason=${reason},reconcile_count=${reconciliations},lease_token=null,lease_until=null,version=version+1,updated_at=${now} where id=${row.id}`.execute(
        trx,
      );
      if (
        (status === "delivered" ||
          (status === "sent" &&
            this.provider.name === "outbox" &&
            outcome.settled)) &&
        row.recurrence !== "none"
      ) {
        try {
          const recurrence = nextOccurrence(
            row.local_due,
            row.timezone,
            row.recurrence,
            row.disambiguation,
            now,
          );
          await sql`update reminders set status='scheduled',occurrence=occurrence+1,due_at=${recurrence.due},local_due=${recurrence.local},next_attempt_at=${recurrence.due},send_count=0,reconcile_count=0,skipped_count=skipped_count+${recurrence.skipped},reason=${recurrence.skipped ? "missed_repeats_skipped" : null} where id=${row.id}`.execute(
            trx,
          );
        } catch {
          await sql`update reminders set status='failed',attention=true,reason='recurrence_time_needs_review',next_attempt_at=null where id=${row.id}`.execute(
            trx,
          );
        }
      }
      await audit(
        trx,
        row.user_id,
        `reminder_${status}`,
        row.id,
        row.correlation_id,
      );
      return {
        event: "reminder_result",
        reminderId: row.id,
        attemptId: attempt.id,
        correlationId: row.correlation_id,
        status,
        attention,
        mode: this.provider.name === "mock" ? "mock_only" : "live",
      };
    });
    if (result) this.logger.info(result);
  }
  async runOnce() {
    await this.heartbeat();
    const claim = await this.claim();
    if (!claim) return false;
    const work = await this.prepare(claim);
    if (!work) return true;
    const outcome = await boundedProviderCall(
      (signal) =>
        work.reconcile
          ? this.provider.reconcile(work.attempt.idempotency_key, signal)
          : this.provider.send(
              {
                key: work.attempt.idempotency_key,
                title: work.row.title,
                body: work.row.body,
                reminder: work.row,
              },
              signal,
            ),
      this.policy.timeoutMs,
    );
    await this.complete(
      work,
      outcome.status === "not_found" && !work.reconcile
        ? { status: "unknown", category: "unknown" }
        : outcome,
    );
    return true;
  }
}
