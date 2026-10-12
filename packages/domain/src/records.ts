import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely, type Transaction } from "kysely";
import type { Database } from "../../database/src/index.js";
import {
  projectSchema,
  taskSchema,
  memorySchema,
  type Table,
  type RowMap,
  type ListInput,
} from "../../shared/src/contracts.js";
import { DomainError } from "./errors.js";

type DB = Kysely<Database> | Transaction<Database>;
const schemas = {
  projects: projectSchema,
  tasks: taskSchema,
  memory_items: memorySchema,
};
const memoryColumns = sql`id,user_id,project_id,content,kind,scope,truth_status,sensitivity,save_consent_at,source_type,archived_at,created_at,updated_at,version`;
const columns = (table: Table) =>
  table === "memory_items" ? memoryColumns : sql`*`;

export async function audit(
  db: DB,
  userId: string,
  event: string,
  entityId: string | null,
  requestId: string,
) {
  await sql`insert into audit_events(id,user_id,event_type,entity_id,correlation_id) values (${randomUUID()},${userId},${event},${entityId},${requestId})`.execute(
    db,
  );
}

export async function getRecord<K extends Table>(
  db: DB,
  table: K,
  userId: string,
  id: string,
): Promise<RowMap[K]> {
  const result = await sql<
    RowMap[K]
  >`select ${columns(table)} from ${sql.table(table)} where user_id=${userId} and id=${id}`.execute(
    db,
  );
  const record = result.rows[0];
  if (!record) throw new DomainError("NOT_FOUND", 404, "Record not found.");
  return record;
}

export async function listRecords<K extends Table>(
  db: DB,
  table: K,
  userId: string,
  input: ListInput,
) {
  const filters = [sql`user_id=${userId}`];
  if (input.project_id && table !== "projects")
    filters.push(sql`project_id=${input.project_id}`);
  if (input.archived !== "all")
    filters.push(
      table === "projects"
        ? input.archived === "true"
          ? sql`status='archived'`
          : sql`status<>'archived'`
        : input.archived === "true"
          ? sql`archived_at is not null`
          : sql`archived_at is null`,
    );
  if (input.q)
    filters.push(
      table === "memory_items"
        ? sql`search_vector @@ websearch_to_tsquery('english',${input.q})`
        : sql`${sql.ref(table === "projects" ? "name" : "title")} ilike ${`%${input.q.replace(/[\\%_]/g, "\\$&")}%`}`,
    );
  const result = await sql<
    RowMap[K]
  >`select ${columns(table)} from ${sql.table(table)} where ${sql.join(filters, sql` and `)} order by created_at desc,id desc limit ${input.limit + 1} offset ${input.offset}`.execute(
    db,
  );
  return {
    items: result.rows.slice(0, input.limit),
    hasMore: result.rows.length > input.limit,
  };
}

function normalize(table: Table, input: unknown) {
  const value = schemas[table].parse(input);
  const result: Record<string, unknown> = { ...value };
  if ("archived" in value) {
    result.archived_at = value.archived ? new Date() : null;
    delete result.archived;
  }
  if ("content" in value) {
    if (
      value.sensitivity === "ordinary" &&
      /\b(diagnos\w*|medical|medication|health condition|sexual|passport|social security|bank account|home address|date of birth)\b/i.test(
        value.content,
      )
    ) {
      throw new DomainError(
        "CONSENT_REQUIRED",
        422,
        "This may be personal information. Select sensitive and explicitly confirm saving it.",
      );
    }
    // Block credential-shaped content. This is a conservative heuristic, not a claim of perfect detection.
    if (
      /-----BEGIN [A-Z ]*PRIVATE KEY|\b(?:password|api[ _-]?key|access[ _-]?token|secret)\s*[:=]\s*\S+|\bsk-[\w-]{16,}|\bAKIA[A-Z0-9]{16}\b/i.test(
        value.content,
      )
    ) {
      throw new DomainError(
        "SECRET_NOT_ALLOWED",
        422,
        "Credentials cannot be saved as memory.",
      );
    }
    // Every manually captured memory requires an explicit privacy classification.
    if (value.sensitivity === "sensitive" && !value.consent)
      throw new DomainError(
        "CONSENT_REQUIRED",
        422,
        "Confirm saving this sensitive memory.",
      );
    result.save_consent_at =
      value.sensitivity === "sensitive" ? new Date() : null;
    delete result.consent;
  }
  if ("status" in value && table === "tasks")
    result.completion_at = value.status === "completed" ? new Date() : null;
  return { value, fields: result };
}

export async function saveRecord<K extends Table>(
  db: Kysely<Database>,
  table: K,
  userId: string,
  input: unknown,
  requestId: string,
  options: { key: string } | { id: string; version: number },
) {
  const { value, fields } = normalize(table, input);
  return db.transaction().execute(async (trx) => {
    let old: RowMap[K] | undefined;
    let id: string;
    if ("id" in options) {
      id = options.id;
      const locked = await sql<
        RowMap[K]
      >`select ${columns(table)} from ${sql.table(table)} where user_id=${userId} and id=${id} for update`.execute(
        trx,
      );
      old = locked.rows[0];
      if (!old) throw new DomainError("NOT_FOUND", 404, "Record not found.");
      if (old.version !== options.version)
        throw new DomainError(
          "CONFLICT",
          409,
          "This record changed. Reload before saving.",
        );
      if (table === "tasks") {
        const previous = old as RowMap["tasks"];
        if (
          ["completed", "cancelled"].includes(previous.status) &&
          fields.status !== previous.status &&
          fields.status !== "inbox"
        ) {
          throw new DomainError(
            "CONFLICT",
            409,
            "Reopen this task to Inbox before changing its status.",
          );
        }
        if (previous.status === fields.status)
          fields.completion_at = previous.completion_at;
      }
    } else {
      id = randomUUID();
      const hash = createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
      const inserted =
        await sql`insert into request_keys(user_id,key,operation,payload_hash,entity_id) values (${userId},${options.key},${table},${hash},${id}) on conflict do nothing returning entity_id`.execute(
          trx,
        );
      if (!inserted.rows.length) {
        const existing = await sql<{
          operation: string;
          payload_hash: string;
          entity_id: string;
        }>`select operation,payload_hash,entity_id from request_keys where user_id=${userId} and key=${options.key}`.execute(
          trx,
        );
        const previous = existing.rows[0];
        if (previous?.operation !== table || previous?.payload_hash !== hash)
          throw new DomainError(
            "CONFLICT",
            409,
            "This request key was already used for different content.",
          );
        return getRecord(trx, table, userId, previous.entity_id);
      }
    }
    if (fields.project_id)
      await getRecord(trx, "projects", userId, String(fields.project_id));
    const entries = Object.entries(fields);
    if (old) {
      await sql`update ${sql.table(table)} set ${sql.join(entries.map(([key, v]) => sql`${sql.ref(key)}=${v}`))}, updated_at=now(),version=version+1 where user_id=${userId} and id=${id}`.execute(
        trx,
      );
    } else {
      await sql`insert into ${sql.table(table)} (id,user_id,${sql.join(entries.map(([key]) => sql.ref(key)))}) values (${id},${userId},${sql.join(entries.map(([, v]) => sql`${v}`))})`.execute(
        trx,
      );
    }
    if (
      table === "tasks" &&
      (!old || (old as RowMap["tasks"]).status !== fields.status)
    ) {
      await sql`insert into task_events(id,user_id,task_id,event_type,from_status,to_status) values (${randomUUID()},${userId},${id},${old ? "status_changed" : "created"},${old ? (old as RowMap["tasks"]).status : null},${fields.status})`.execute(
        trx,
      );
    }
    await audit(
      trx,
      userId,
      `${table}_${old ? "updated" : "created"}`,
      id,
      requestId,
    );
    return getRecord(trx, table, userId, id);
  });
}

export async function deleteRecord(
  db: Kysely<Database>,
  table: Table,
  userId: string,
  id: string,
  version: number,
  requestId: string,
) {
  await db.transaction().execute(async (trx) => {
    const result =
      await sql`delete from ${sql.table(table)} where user_id=${userId} and id=${id} and version=${version} returning id`.execute(
        trx,
      );
    if (!result.rows.length) {
      await getRecord(trx, table, userId, id);
      throw new DomainError(
        "CONFLICT",
        409,
        "This record changed. Reload before deleting.",
      );
    }
    await audit(trx, userId, `${table}_deleted`, id, requestId);
  });
}
