import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import type { Logger } from "pino";
import type { Database } from "../../../packages/database/src/index.js";
import type {
  Channel,
  DeliveryJob,
} from "../../../packages/shared/src/notifications.js";
import type { Reminder } from "../../../packages/shared/src/reminders.js";
import {
  notificationSettings,
  enqueueReminder,
  enqueueDelivery,
  confirmed,
  terminal,
  rateWindow,
  applyDeliveryResult,
  wakeReminder,
  deliveryWebhook,
} from "../../../packages/domain/src/notifications.js";
import {
  deliveryCall,
  type ChannelAdapter,
  type OutboundNotification,
} from "../../../packages/domain/src/notification-provider.js";
import { getPreferences } from "../../../packages/domain/src/reminders.js";
import { deferredUntil } from "../../../packages/domain/src/reminder-time.js";
import { audit } from "../../../packages/domain/src/records.js";
import { retryDelay, workerPolicy, type WorkerPolicy } from "./engine.js";
import type { NotificationProvider } from "./provider.js";

export function outboxProvider(
  db: Kysely<Database>,
  clock: () => Date = () => new Date(),
): NotificationProvider {
  async function state(key: string) {
    let jobs = (
      await sql<DeliveryJob>`select * from notification_jobs where logical_key=${key}`.execute(
        db,
      )
    ).rows;
    if (!jobs.length) {
      // Recover a scheduler crash before outbox insertion; this is only a DB write.
      const row = (
        await sql<Reminder>`select * from reminders where idempotency_key::text || ':' || occurrence::text=${key} and status<>'cancelled'`.execute(
          db,
        )
      ).rows[0];
      if (row) {
        await enqueueReminder(
          db,
          row.id,
          row.user_id,
          row.occurrence,
          key,
          clock(),
        );
        jobs = (
          await sql<DeliveryJob>`select * from notification_jobs where logical_key=${key}`.execute(
            db,
          )
        ).rows;
      }
    }
    if (jobs.some((j) => confirmed(j.status)))
      return { status: "delivered" as const };
    if (
      jobs.length &&
      jobs.every((j) => terminal(j.status)) &&
      !jobs.some((j) => j.fallback_deadline_at)
    )
      return { status: "failed" as const, category: "permanent" as const };
    return { status: "sent" as const };
  }
  return {
    name: "outbox",
    async send(input) {
      if (!input.reminder)
        return { status: "failed", category: "configuration" };
      await enqueueReminder(
        db,
        input.reminder.id,
        input.reminder.user_id,
        input.reminder.occurrence,
        input.key,
        clock(),
      );
      return state(input.key);
    },
    reconcile: state,
  };
}
export class DeliveryEngine {
  constructor(
    readonly db: Kysely<Database>,
    readonly adapters: Record<Channel, ChannelAdapter>,
    readonly logger: Logger,
    readonly clock: () => Date = () => new Date(),
    readonly policy: WorkerPolicy = workerPolicy(),
    readonly random: () => number = Math.random,
  ) {}
  async fallbacks() {
    const now = this.clock();
    const candidates = (
      await sql<DeliveryJob>`select * from notification_jobs where channel='whatsapp' and kind='reminder' and fallback_deadline_at is not null and (fallback_deadline_at<=${now} or status in ('delivered','read','failed','undelivered','blocked')) order by fallback_deadline_at limit 1`.execute(
        this.db,
      )
    ).rows;
    for (const candidate of candidates) {
      if (candidate.provider_message_id && !terminal(candidate.status)) {
        const result = await deliveryCall(
          (signal) =>
            this.adapters.whatsapp.reconcile(
              candidate.provider_message_id!,
              signal,
            ),
          this.policy.timeoutMs,
        );
        await deliveryWebhook(
          this.db,
          "twilio",
          `deadline:${candidate.id}:${result.status}`,
          candidate.provider_message_id!,
          result,
          { jobId: candidate.id },
          now,
        );
      }
      await this.db.transaction().execute(async (trx) => {
        await sql`select id from users where id=${candidate.user_id} for update`.execute(
          trx,
        );
        const primary = (
          await sql<DeliveryJob>`select * from notification_jobs where id=${candidate.id} for update`.execute(
            trx,
          )
        ).rows[0]!;
        if (!primary.fallback_deadline_at) return;
        if (confirmed(primary.status)) {
          await sql`update notification_jobs set fallback_deadline_at=null where id=${primary.id}`.execute(
            trx,
          );
          return;
        }
        const reminder = (
          await sql<Reminder>`select * from reminders where id=${primary.reminder_id} and user_id=${primary.user_id} for update`.execute(
            trx,
          )
        ).rows[0];
        const preferences = await notificationSettings(trx, primary.user_id);
        if (
          reminder &&
          reminder.occurrence === primary.occurrence &&
          reminder.status !== "cancelled" &&
          preferences.fallback_enabled &&
          preferences.revision === primary.preference_revision
        ) {
          // Enqueue even when email is missing: the blocked fallback stays visible.
          await enqueueDelivery(
            trx,
            primary.user_id,
            primary.logical_key,
            "email",
            preferences,
            now,
            reminder,
            primary.id,
          );
          await audit(
            trx,
            primary.user_id,
            "notification_fallback_created",
            primary.id,
            randomUUID(),
          );
        }
        await sql`update notification_jobs set fallback_deadline_at=null where id=${primary.id}`.execute(
          trx,
        );
        await wakeReminder(trx, primary, now);
      });
    }
  }
  async claim() {
    const now = this.clock();
    return (
      (
        await sql<DeliveryJob>`with candidate as (select id from notification_jobs where next_attempt_at<=${now} and (lease_until is null or lease_until<=${now}) order by next_attempt_at,id for update skip locked limit 1)
      update notification_jobs j set lease_token=${randomUUID()},lease_until=${new Date(now.getTime() + this.policy.leaseMs)} from candidate c where j.id=c.id returning j.*`.execute(
          this.db,
        )
      ).rows[0] || null
    );
  }
  async prepare(claim: DeliveryJob): Promise<{
    job: DeliveryJob;
    input: OutboundNotification;
    reconcile: boolean;
    attemptId: string | null;
  } | null> {
    return this.db.transaction().execute(async (trx) => {
      const user = (
        await sql<{
          email: string;
          email_verified_at: string | null;
          timezone: string | null;
        }>`select email,email_verified_at,timezone from users where id=${claim.user_id} for update`.execute(
          trx,
        )
      ).rows[0]!;
      const job = (
        await sql<DeliveryJob>`select * from notification_jobs where id=${claim.id} for update`.execute(
          trx,
        )
      ).rows[0]!;
      const now = this.clock();
      if (
        job.lease_token !== claim.lease_token ||
        !job.lease_until ||
        new Date(job.lease_until) <= now
      )
        return null;
      const release = async (
        status: DeliveryJob["status"],
        reason: string | null,
        next: Date | null,
      ) => {
        await sql`update notification_jobs set status=${status},error_category=${reason},next_attempt_at=${next},attention=${terminal(status) && !confirmed(status)},lease_token=null,lease_until=null,updated_at=${now} where id=${job.id}`.execute(
          trx,
        );
        await wakeReminder(trx, job, now);
      };
      if (terminal(job.status)) {
        await release(job.status, job.error_category, null);
        return null;
      }
      const reconcile = ["submitting", "accepted", "sent", "unknown"].includes(
        job.status,
      );
      const settings = await notificationSettings(trx, job.user_id);
      const reminder = job.reminder_id
        ? (
            await sql<Reminder>`select * from reminders where user_id=${job.user_id} and id=${job.reminder_id} for update`.execute(
              trx,
            )
          ).rows[0]
        : undefined;
      const input: OutboundNotification = {
        key: `${job.logical_key}:${job.channel}`,
        jobId: job.id,
        destination: job.destination || "",
        title: reminder?.title || "Your notification channel is connected",
        body: reminder?.body || "This is the AXIS channel test you requested.",
        due: reminder?.due_at || job.created_at,
        timezone: reminder?.timezone || user.timezone || "UTC",
        reminderId: job.reminder_id,
        windowUntil: settings.whatsapp_window_until,
      };
      if (reconcile) {
        const attempt = (
          await sql<{
            id: string;
          }>`select id from notification_attempts where job_id=${job.id} order by attempt_number desc limit 1`.execute(
            trx,
          )
        ).rows[0];
        await sql`update notification_jobs set status='unknown' where id=${job.id} and status='submitting'`.execute(
          trx,
        );
        await sql`update notification_attempts set status='unknown',error_category='unknown' where job_id=${job.id} and status='sending'`.execute(
          trx,
        );
        return { job, input, reconcile, attemptId: attempt?.id || null };
      }
      if (
        job.preference_revision !== settings.revision ||
        !job.destination ||
        (job.channel === "whatsapp"
          ? !settings.whatsapp_enabled ||
            !settings.whatsapp_verified_at ||
            job.destination !== settings.whatsapp_destination
          : !settings.email_enabled ||
            !user.email_verified_at ||
            job.destination !== user.email ||
            job.destination !== settings.email_destination)
      ) {
        await release("blocked", "consent_or_destination_changed", null);
        return null;
      }
      if (
        job.kind === "reminder" &&
        (!reminder ||
          reminder.occurrence !== job.occurrence ||
          reminder.status === "cancelled")
      ) {
        await release("suppressed", "schedule_changed", null);
        return null;
      }
      if (job.fallback_of) {
        const primary = (
          await sql<DeliveryJob>`select * from notification_jobs where id=${job.fallback_of} for update`.execute(
            trx,
          )
        ).rows[0]!;
        if (confirmed(primary.status)) {
          await release("suppressed", "primary_delivered", null);
          return null;
        }
      }
      const deferred = deferredUntil(
        now,
        user.timezone || reminder?.timezone || "UTC",
        await getPreferences(trx, job.user_id),
      );
      if (deferred) {
        await release(job.status, "quiet_or_focus", deferred);
        return null;
      }
      if (job.attempt_count >= this.policy.maxAttempts) {
        await release("failed", "retry_exhausted", null);
        return null;
      }
      if (
        !(await rateWindow(trx, `delivery:${job.user_id}`, 10, now, 60000)) ||
        !(await rateWindow(trx, `provider:${job.provider}`, 30, now, 60000))
      ) {
        await release(
          job.status,
          "rate_limit",
          new Date(now.getTime() + 60000),
        );
        return null;
      }
      const attemptId = randomUUID();
      await sql`insert into notification_attempts(id,user_id,reminder_id,occurrence,occurrence_due_at,channel,provider,status,attempt_number,idempotency_key,started_at,job_id) values (${attemptId},${job.user_id},${job.reminder_id},${job.occurrence},${reminder?.due_at || null},${job.channel},${job.provider},'sending',${job.attempt_count + 1},${input.key},${now},${job.id})`.execute(
        trx,
      );
      const deadline =
        job.channel === "whatsapp" &&
        job.attempt_count === 0 &&
        job.kind === "reminder" &&
        settings.fallback_enabled
          ? new Date(now.getTime() + settings.fallback_after_seconds * 1000)
          : null;
      await sql`update notification_jobs set status='submitting',attempt_count=attempt_count+1,fallback_deadline_at=coalesce(fallback_deadline_at,${deadline}),updated_at=${now} where id=${job.id}`.execute(
        trx,
      );
      await audit(
        trx,
        job.user_id,
        "notification_dispatch_started",
        job.id,
        randomUUID(),
      );
      return {
        job: { ...job, attempt_count: job.attempt_count + 1 },
        input,
        reconcile: false,
        attemptId,
      };
    });
  }
  async complete(
    work: NonNullable<Awaited<ReturnType<DeliveryEngine["prepare"]>>>,
    outcome: import("../../../packages/domain/src/notification-provider.js").DeliveryResult,
  ) {
    await this.db.transaction().execute(async (trx) => {
      await sql`select id from users where id=${work.job.user_id} for update`.execute(
        trx,
      );
      const job = (
        await sql<DeliveryJob>`select * from notification_jobs where id=${work.job.id} for update`.execute(
          trx,
        )
      ).rows[0]!;
      const now = this.clock();
      if (
        job.lease_token !== work.job.lease_token ||
        !job.lease_until ||
        new Date(job.lease_until) <= now
      )
        return;
      // A callback can win while HTTP is in flight; never overwrite its stronger evidence.
      const status = await applyDeliveryResult(trx, job, outcome, now);
      const reconciliations = job.reconcile_count + (work.reconcile ? 1 : 0);
      const retry =
        status === "failed" &&
        outcome.category === "rate_limit" &&
        !work.reconcile &&
        job.attempt_count < this.policy.maxAttempts;
      const attention =
        !confirmed(status) &&
        !retry &&
        (terminal(status) || reconciliations >= this.policy.maxReconciliations);
      const next = retry
        ? new Date(
            now.getTime() +
              Math.max(
                outcome.retryAfterMs || 0,
                retryDelay(job.attempt_count, this.policy, this.random),
              ),
          )
        : !terminal(status) && !attention
          ? new Date(
              now.getTime() +
                retryDelay(reconciliations + 1, this.policy, this.random),
            )
          : null;
      await sql`update notification_jobs set status=${retry ? "retry_scheduled" : status},reconcile_count=${reconciliations},next_attempt_at=${next},attention=${attention},lease_token=null,lease_until=null,updated_at=${now} where id=${job.id}`.execute(
        trx,
      );
      if (work.attemptId)
        await sql`update notification_attempts set status=${status},provider_message_id=coalesce(provider_message_id,${outcome.messageId || null}),error_category=${outcome.category || null},finished_at=${now} where id=${work.attemptId}`.execute(
          trx,
        );
      await audit(
        trx,
        job.user_id,
        "notification_delivery_result",
        job.id,
        randomUUID(),
      );
      this.logger.info({
        event: "notification_delivery_result",
        jobId: job.id,
        channel: job.channel,
        status: retry ? "retry_scheduled" : status,
        attention,
      });
    });
  }
  async runOnce() {
    // Reconcile an eligible primary before its fallback is activated below.
    const claim = await this.claim();
    if (claim) {
      const work = await this.prepare(claim);
      if (work) {
        const adapter = this.adapters[work.job.channel];
        const outcome = await deliveryCall(
          (signal) =>
            work.reconcile
              ? work.job.provider_message_id
                ? adapter.reconcile(work.job.provider_message_id, signal)
                : Promise.resolve({ status: "unknown", category: "unknown" })
              : adapter.send(work.input, signal),
          this.policy.timeoutMs,
        );
        await this.complete(work, outcome);
      }
    }
    await this.fallbacks();
    return !!claim;
  }
}
