import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

export interface Database {
  foundation_metadata: { id: number; schema_version: number };
}

export function createDatabase(connectionString: string) {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 2000,
        query_timeout: 2000,
        statement_timeout: 2000,
        options: "-c timezone=UTC",
      }),
    }),
  });
}

export async function checkDatabase(db: Kysely<Database>) {
  const result = await sql<{
    schema_version: number;
  }>`select schema_version from foundation_metadata where id = 1`.execute(db);
  if (result.rows[0]?.schema_version !== 13)
    throw new Error("Schema unavailable");
  await checkRecovery(db);
}

export async function checkRecovery(db: Kysely<Database>) {
  const r = await sql<{
    quarantined: boolean;
  }>`select quarantined from recovery_control where id=1`.execute(db);
  if (r.rows[0]?.quarantined !== false) throw new Error("Recovery quarantine");
}

// Compose existing domain writes inside a caller's atomic confirmation transaction.
export async function inTransaction<T>(
  db: Kysely<Database>,
  work: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  return db.isTransaction ? work(db) : db.transaction().execute(work);
}
