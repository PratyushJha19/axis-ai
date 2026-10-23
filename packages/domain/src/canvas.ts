import { sql, type Kysely } from "kysely";
import type { Database } from "../../database/src/index.js";
import { inTransaction } from "../../database/src/index.js";
import { canvasSchema, type Canvas } from "../../shared/src/canvas.js";
import { audit, getRecord, saveRecord } from "./records.js";
import { DomainError } from "./errors.js";

export async function getCanvas(
  db: Kysely<Database>,
  user: string,
  id: string,
): Promise<Canvas> {
  return inTransaction(db, async (db) => {
    const row = (
      await sql<
        Omit<Canvas, "nodes" | "edges">
      >`select id,name,project_id,viewport,version,updated_at from canvases where user_id=${user} and id=${id} for share`.execute(
        db,
      )
    ).rows[0];
    if (!row) throw new DomainError("NOT_FOUND", 404, "Canvas not found.");
    const nodes = (
      await sql<
        Canvas["nodes"][number]
      >`select id,kind,title,content,x,y,width,height,task_id from canvas_nodes where user_id=${user} and canvas_id=${id} order by id`.execute(
        db,
      )
    ).rows;
    const edges = (
      await sql<
        Canvas["edges"][number]
      >`select id,source,target,label from canvas_edges where user_id=${user} and canvas_id=${id} order by id`.execute(
        db,
      )
    ).rows;
    return { ...row, nodes, edges };
  });
}
export async function saveCanvas(
  db: Kysely<Database>,
  user: string,
  id: string,
  input: unknown,
  version: number | null,
  request: string,
) {
  const value = canvasSchema.parse(input);
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${user} for update`.execute(trx);
    if (value.project_id)
      await getRecord(trx, "projects", user, value.project_id);
    for (const node of value.nodes)
      if (node.task_id) await getRecord(trx, "tasks", user, node.task_id);
    const old = (
      await sql<{
        version: number;
      }>`select version from canvases where user_id=${user} and id=${id} for update`.execute(
        trx,
      )
    ).rows[0];
    if (version !== null && !old)
      throw new DomainError("NOT_FOUND", 404, "Canvas not found.");
    if (old && old.version !== version)
      throw new DomainError(
        "CONFLICT",
        409,
        "Canvas changed elsewhere. Keep your draft and reload the saved version before merging.",
      );
    if (old) {
      await sql`update canvases set name=${value.name},project_id=${value.project_id},viewport=${JSON.stringify(value.viewport)}::jsonb,version=version+1,updated_at=now() where user_id=${user} and id=${id}`.execute(
        trx,
      );
      await sql`delete from canvas_nodes where user_id=${user} and canvas_id=${id}`.execute(
        trx,
      );
    } else {
      await sql`insert into canvases(id,user_id,project_id,name,viewport) values(${id},${user},${value.project_id},${value.name},${JSON.stringify(value.viewport)}::jsonb)`.execute(
        trx,
      );
    }
    for (const n of value.nodes)
      await sql`insert into canvas_nodes(id,canvas_id,user_id,kind,title,content,x,y,width,height,task_id) values(${n.id},${id},${user},${n.kind},${n.title},${n.content},${n.x},${n.y},${n.width},${n.height},${n.task_id})`.execute(
        trx,
      );
    for (const e of value.edges)
      await sql`insert into canvas_edges(id,canvas_id,user_id,source,target,label) values(${e.id},${id},${user},${e.source},${e.target},${e.label})`.execute(
        trx,
      );
    await audit(trx, user, "canvas_saved", id, request);
    return getCanvas(trx, user, id);
  });
}
export async function deleteCanvas(
  db: Kysely<Database>,
  user: string,
  id: string,
  version: number,
  request: string,
) {
  return db.transaction().execute(async (trx) => {
    const result =
      await sql`delete from canvases where user_id=${user} and id=${id} and version=${version} returning id`.execute(
        trx,
      );
    if (!result.rows.length)
      throw new DomainError(
        "CONFLICT",
        409,
        "Canvas changed or was removed. Reload before deleting.",
      );
    await audit(trx, user, "canvas_deleted", id, request);
  });
}
export async function canvasTask(
  db: Kysely<Database>,
  user: string,
  id: string,
  nodeId: string,
  version: number,
  input: unknown,
  request: string,
) {
  return db.transaction().execute(async (trx) => {
    await sql`select id from users where id=${user} for update`.execute(trx);
    const canvas = await getCanvas(trx, user, id);
    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node) throw new DomainError("NOT_FOUND", 404, "Node not found.");
    if (node.task_id) return getRecord(trx, "tasks", user, node.task_id);
    if (canvas.version !== version)
      throw new DomainError(
        "CONFLICT",
        409,
        "Save or reload the canvas before converting.",
      );
    const task = await saveRecord(trx, "tasks", user, input, request, {
      key: nodeId,
    });
    await sql`update canvas_nodes set task_id=${task.id},kind='Task' where user_id=${user} and canvas_id=${id} and id=${nodeId}`.execute(
      trx,
    );
    await sql`update canvases set version=version+1,updated_at=now() where user_id=${user} and id=${id}`.execute(
      trx,
    );
    return task;
  });
}
