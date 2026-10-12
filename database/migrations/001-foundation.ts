import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>) {
  await db.schema
    .createTable("foundation_metadata")
    .addColumn("id", "integer", (col) => col.primaryKey().check(sql`id = 1`))
    .addColumn("schema_version", "integer", (col) =>
      col.notNull().check(sql`schema_version > 0`),
    )
    .execute();
  await sql`insert into foundation_metadata (id, schema_version) values (1, 1)`.execute(
    db,
  );
}
