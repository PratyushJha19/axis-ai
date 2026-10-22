import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "../../database/src/index.js";
import {
  approvalType,
  type ChatAction,
  type ChatDraft,
} from "../../shared/src/chat-actions.js";
import { listSchema } from "../../shared/src/contracts.js";
import { getRecord, listRecords, audit } from "./records.js";
import { getReminder } from "./reminders.js";
import { proposeAction, operateApproval } from "./approvals.js";
import { rateWindow } from "./notifications.js";
import { assertNoCredentials } from "./ai.js";
import { DomainError } from "./errors.js";

export const telegramHelp = `AXIS commands (private, linked account only):
/tasks — latest 10 active tasks with IDs
/reminders — latest 10 active reminders with IDs
/task Title — propose a task
/remind YYYY-MM-DDTHH:mm | Title — propose a reminder in your AXIS timezone
/complete TASK_ID — propose completion
/rename TASK_ID | New title — propose renaming
/cancel REMINDER_ID — propose cancellation
/reschedule REMINDER_ID | YYYY-MM-DDTHH:mm — move the next attempt (recurrence unchanged)
/confirm ACTION_ID or /reject ACTION_ID — decide the exact preview
/status — last 5 command results
/help — show this help
Natural language can draft new tasks/reminders using your saved AI key; each message is independent. Changes always need confirmation. Permanent deletion, credentials and other features stay in the AXIS dashboard. /stop revokes access and reminder consent.`;

export type TelegramCommand = {
  id: string;
  user_id: string;
  bot_id: string;
  destination: string;
  link_revision: string;
  input: string;
  status: string;
};
export async function telegramIdentity(
  db: Kysely<Database>,
  command: Pick<
    TelegramCommand,
    "user_id" | "bot_id" | "destination" | "link_revision"
  >,
) {
  return !!(
    await sql`select user_id from notification_preferences where user_id=${command.user_id} and telegram_bot_id=${command.bot_id} and telegram_destination=${command.destination} and revision=${command.link_revision} and telegram_verified_at is not null`.execute(
      db,
    )
  ).rows.length;
}

// Caller holds the owner lock. Input is never logged or sent to AI at ingress.
export async function enqueueTelegramCommand(
  db: Kysely<Database>,
  bot: string,
  update: number,
  user: string,
  destination: string,
  input: string,
  now: Date,
) {
  const prefs = (
    await sql<{
      revision: string;
    }>`select revision from notification_preferences where user_id=${user} and telegram_bot_id=${bot} and telegram_destination=${destination} and telegram_verified_at is not null`.execute(
      db,
    )
  ).rows[0];
  if (!prefs) return;
  // Persist a content-free dedupe marker even when the rate limit drops an update.
  if (
    !(
      await sql`insert into notification_events(provider,event_id) values ('telegram',${`${bot}:${update}`}) on conflict do nothing returning event_id`.execute(
        db,
      )
    ).rows.length
  )
    return;
  if (!(await rateWindow(db, `telegram-command:${user}`, 20, now, 60000)))
    return;
  let safe = input;
  try {
    assertNoCredentials(input);
  } catch {
    safe = "/credentials-rejected";
  }
  await sql`insert into telegram_commands(bot_id,update_id,user_id,destination,link_revision,input) values (${bot},${update},${user},${destination},${prefs.revision},${safe}) on conflict do nothing`.execute(
    db,
  );
}

export function parseTelegramCommand(input: string) {
  const text = input.trim();
  const [command = "", ...rest] = text.split(/\s+/);
  return { command: command.toLowerCase(), argument: rest.join(" ") };
}

export async function commandReply(
  db: Kysely<Database>,
  c: TelegramCommand,
  body: string,
  proposal?: string,
) {
  assertNoCredentials(body);
  await sql`insert into telegram_command_replies(id,user_id,bot_id,destination,link_revision,body,proposal_id) values (${c.id},${c.user_id},${c.bot_id},${c.destination},${c.link_revision},${Array.from(body).slice(0, 4000).join("")},${proposal ?? null}) on conflict do nothing`.execute(
    db,
  );
  await sql`update telegram_commands set status='done',input='',lease_until=null where id=${c.id}`.execute(
    db,
  );
  await audit(db, c.user_id, "telegram_command_completed", c.id, c.id);
}

export async function processTelegramCommand(
  db: Kysely<Database>,
  c: TelegramCommand,
  interpreted?: { reply: string; payload?: ChatAction["payload"] },
) {
  const { command, argument } = parseTelegramCommand(c.input);
  const user = c.user_id;
  if (command === "/help" || command === "/start")
    return { body: telegramHelp };
  if (command === "/credentials-rejected")
    return {
      body: "Credentials are not accepted in Telegram commands. Use AI Settings. If you sent a real secret to Telegram, revoke it at its provider.",
    };
  if (command === "/status") {
    const rows = (
      await sql<{
        id: string;
        status: string;
        reply_status: string | null;
      }>`select c.id,c.status,r.status as reply_status from telegram_commands c left join telegram_command_replies r on r.id=c.id where c.user_id=${user} and c.id<>${c.id} order by c.created_at desc limit 5`.execute(
        db,
      )
    ).rows;
    return {
      body:
        rows
          .map(
            (r) =>
              `${r.id}: command ${r.status}; reply ${r.reply_status ?? "not queued"}`,
          )
          .join("\n") || "No earlier commands.",
    };
  }
  if (command === "/tasks") {
    const result = await listRecords(
      db,
      "tasks",
      user,
      listSchema.parse({ limit: 10 }),
    );
    return {
      body:
        result.items
          .map((t) => `${t.title} [${t.status}]\nID: ${t.id}`)
          .join("\n\n") +
          (result.hasMore ? "\nMore tasks are available in AXIS." : "") ||
        "No active tasks.",
    };
  }
  if (command === "/reminders") {
    const rows = (
      await sql<{
        id: string;
        title: string;
        status: string;
        due_at: string;
        timezone: string;
        next_attempt_at: string | null;
      }>`select id,title,status,due_at,timezone,next_attempt_at from reminders where user_id=${user} and archived_at is null order by created_at desc limit 10`.execute(
        db,
      )
    ).rows;
    return {
      body:
        rows
          .map(
            (r) =>
              `${r.title} [${r.status}]\n${new Intl.DateTimeFormat("en", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(r.next_attempt_at || r.due_at))} (${r.timezone})\nID: ${r.id}`,
          )
          .join("\n\n") || "No active reminders.",
    };
  }
  if (["/confirm", "/reject"].includes(command)) {
    const id = z.uuid().parse(argument);
    const proposal = (
      await sql<ChatAction>`select p.* from ai_action_proposals p join telegram_command_proposals t on t.proposal_id=p.id where p.user_id=${user} and p.id=${id} and t.user_id=${user} and t.bot_id=${c.bot_id} and t.destination=${c.destination} and t.link_revision=${c.link_revision}`.execute(
        db,
      )
    ).rows[0];
    if (!proposal)
      throw new DomainError(
        "NOT_FOUND",
        404,
        "This action does not belong to this Telegram link. Request a new preview.",
      );
    const outcome = await operateApproval(
      db,
      user,
      id,
      {
        decision: command === "/confirm" ? "confirm" : "reject",
        payload_hash: proposal.payload_hash,
      },
      c.id,
    );
    return {
      body:
        outcome.status === "succeeded"
          ? `Confirmed by AXIS: ${approvalType(proposal.payload)} succeeded.\nRecord: ${outcome.entity_id}`
          : `Action ${outcome.status}.`,
    };
  }
  let draft: ChatDraft | ChatAction["payload"] | undefined;
  if (command === "/task")
    draft = { kind: "task", title: argument, description: "", local_due: null };
  else if (command === "/remind") {
    const [date, ...title] = argument.split("|");
    draft = {
      kind: "reminder",
      title: title.join("|").trim(),
      body: "",
      local_due: date!.trim(),
      recurrence: "none",
    };
  } else if (
    ["/complete", "/rename", "/cancel", "/reschedule"].includes(command)
  ) {
    const [target, ...value] = argument.split("|"),
      id = z.uuid().parse(target!.trim());
    if (command === "/complete" || command === "/rename") {
      const old = await getRecord(db, "tasks", user, id);
      if (old.archived_at)
        throw new DomainError(
          "CONFLICT",
          409,
          "Manage archived tasks in the dashboard.",
        );
      draft = {
        kind: "task",
        title: command === "/rename" ? value.join("|").trim() : old.title,
        description: "",
        local_due: null,
        timezone: null,
        due_at: null,
        change: {
          id,
          version: old.version,
          operation: command === "/rename" ? "rename" : "complete",
        },
      };
    } else {
      const old = await getReminder(db, user, id);
      draft = {
        kind: "reminder",
        title: old.title,
        body: "",
        local_due: command === "/reschedule" ? value.join("|").trim() : null,
        recurrence: old.recurrence,
        timezone: null,
        due_at: null,
        change: {
          id,
          version: old.version,
          operation: command === "/cancel" ? "cancel" : "reschedule",
        },
      };
    }
  } else if (interpreted?.payload) draft = interpreted.payload;
  else
    return {
      body:
        interpreted?.reply ||
        "Unsupported command. Use /help. Permanent deletion and other app features remain in the signed-in dashboard.",
    };
  const {
    timezone: _timezone,
    due_at: _due,
    ...payload
  } = draft as ChatAction["payload"];
  const proposal = await proposeAction(
    db,
    user,
    { idempotency_key: c.id, action_type: approvalType(payload), payload },
    c.id,
  );
  await sql`insert into telegram_command_proposals(proposal_id,user_id,bot_id,destination,link_revision) values (${proposal.id},${user},${c.bot_id},${c.destination},${c.link_revision}) on conflict do nothing`.execute(
    db,
  );
  const p = proposal.payload;
  const detail = p.kind === "task" ? p.description : p.body;
  const body = `REVIEW — nothing changed yet.\nAction: ${approvalType(p)}\nTitle: ${p.title}${detail ? `\n${detail}` : ""}${"change" in p ? `\nTarget: ${p.change.id} (version ${p.change.version})` : ""}${p.local_due ? `\nTime: ${p.local_due} (${p.timezone})\nUTC: ${p.due_at}` : ""}${p.kind === "reminder" ? `\nRecurrence: ${p.recurrence}${"change" in p && p.change.operation === "reschedule" ? " (only next attempt moves)" : ""}` : ""}\nExpires: ${new Date(proposal.expires_at).toISOString()}\n/confirm ${proposal.id}\n/reject ${proposal.id}`;
  return { body, proposal: proposal.id };
}
