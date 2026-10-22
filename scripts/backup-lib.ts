import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
  realpath,
} from "node:fs/promises";
import { isAbsolute, join, resolve, relative } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import pg from "pg";
import { z } from "zod";
import { readKey, KeyVault } from "../packages/domain/src/ai-crypto.js";
const exec = promisify(execFile);
const metadata = z
  .object({
    id: z.uuid(),
    created_at: z.iso.datetime(),
    schema: z.union([z.literal(12), z.literal(13)]),
    schema_hash: z.string().regex(/^[a-f0-9]{64}$/),
    format: z.literal("pg-custom-aes256gcm-v1"),
    counts: z.record(
      z.string().regex(/^[a-z_][a-z0-9_]*$/),
      z.string().regex(/^\d+$/),
    ),
    key_version: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
  })
  .strict();
const manifestSchema = metadata
  .extend({
    size: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    iv: z.string(),
    tag: z.string(),
    verified: z.literal(true),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;
export interface BackupConfig {
  directory: string;
  database: string;
  pgBin: string;
  key: Buffer;
  keyVersion: string;
}
const discard = () =>
  new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
export class BackupFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
async function schemaHash(client: pg.Client) {
  const objects = await client.query<{
    definition: string;
  }>(`select definition from (
    select 'index:'||indexname||':'||indexdef definition from pg_indexes where schemaname='public'
    union all select 'constraint:'||c.conrelid::regclass::text||':'||c.conname||':'||pg_get_constraintdef(c.oid) from pg_constraint c where c.connamespace='public'::regnamespace
    union all select 'sequence:'||sequencename||':'||start_value||':'||increment_by from pg_sequences where schemaname='public'
  ) objects order by definition`);
  return createHash("sha256")
    .update(JSON.stringify(objects.rows))
    .digest("hex");
}
export function backupConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackupConfig {
  try {
    const directory = env.BACKUP_DIRECTORY;
    if (
      !directory ||
      !isAbsolute(directory) ||
      !env.DATABASE_URL ||
      !env.BACKUP_ENCRYPTION_KEY
    )
      throw new Error();
    const path = resolve(directory),
      web = resolve("apps/web");
    if (
      path === web ||
      (!relative(web, path).startsWith("..") &&
        !isAbsolute(relative(web, path)))
    )
      throw new Error();
    const database = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol))
      throw new Error();
    const keyVersion = env.BACKUP_KEY_VERSION || "v1";
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(keyVersion)) throw new Error();
    return {
      directory: path,
      database: env.DATABASE_URL,
      pgBin: env.PG_BIN || "",
      key: readKey(env.BACKUP_ENCRYPTION_KEY),
      keyVersion,
    };
  } catch {
    throw new BackupFailure("backup_configuration_invalid");
  }
}
export async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await realpath(directory),
    web = await realpath(resolve("apps/web"));
  const inside = relative(web, actual);
  if (!inside || (!inside.startsWith("..") && !isAbsolute(inside)))
    throw new BackupFailure("backup_directory_is_public");
  if (process.platform === "win32") {
    // A private operator directory is a prerequisite; never silently rewrite ACLs.
    const script =
      "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=Get-Acl -LiteralPath $env:AXIS_BACKUP_ACL_PATH; $allowed=@($sid,'S-1-5-18','S-1-5-32-544'); $owner=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; if($owner -match '^S-1-5-21-'){$allowed+=$owner}; foreach($r in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin $allowed) { exit 2 } }";
    try {
      await exec(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          env: {
            ...process.env,
            PSModulePath: `${process.env.SystemRoot || "C:/Windows"}/System32/WindowsPowerShell/v1.0/Modules`,
            AXIS_BACKUP_ACL_PATH: directory,
          },
          windowsHide: true,
        },
      );
    } catch {
      throw new BackupFailure("backup_directory_not_private");
    }
  } else if (((await stat(directory)).mode & 0o077) !== 0)
    throw new BackupFailure("backup_directory_not_private");
}
const executable = (c: BackupConfig, name: string) =>
  c.pgBin
    ? join(c.pgBin, name + (process.platform === "win32" ? ".exe" : ""))
    : name;
function pgEnvironment(database: string) {
  const u = new URL(database);
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGSSLMODE: u.searchParams.get("sslmode") || "prefer",
    PGCONNECT_TIMEOUT: "10",
  };
}
function child(
  c: BackupConfig,
  name: string,
  args: string[],
  database = c.database,
) {
  const p = spawn(executable(c, name), args, {
    env: pgEnvironment(database),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  p.stderr.resume(); // Provider/driver output can contain private data; never log it.
  const done = new Promise<void>((ok, fail) => {
    p.once("error", () => fail(new BackupFailure("postgres_tool_failed")));
    p.once("close", (code) =>
      code === 0 ? ok() : fail(new BackupFailure("postgres_tool_failed")),
    );
  });
  void done.catch(() => undefined);
  return { p, done };
}
async function checksum(path: string) {
  const h = createHash("sha256");
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest("hex");
}
const artifact = (c: BackupConfig, id: string) => {
  z.uuid().parse(id);
  return join(c.directory, `${id}.axisbackup`);
};
const aad = (m: z.infer<typeof metadata>) =>
  Buffer.from(JSON.stringify(metadata.strip().parse(m)));
export async function readManifest(c: BackupConfig, id: string) {
  z.uuid().parse(id);
  return manifestSchema.parse(
    JSON.parse(await readFile(join(c.directory, `${id}.json`), "utf8")),
  );
}
function decrypt(c: BackupConfig, m: Manifest) {
  if (m.key_version !== c.keyVersion)
    throw new BackupFailure("backup_key_version_unavailable");
  const iv = Buffer.from(m.iv, "base64"),
    tag = Buffer.from(m.tag, "base64");
  if (iv.length !== 12 || tag.length !== 16)
    throw new BackupFailure("backup_envelope_invalid");
  const d = createDecipheriv("aes-256-gcm", c.key, iv);
  d.setAAD(aad(m));
  d.setAuthTag(tag);
  return d;
}
export async function verifyBackup(c: BackupConfig, id: string) {
  return verifyArtifact(c, await readManifest(c, id), id);
}
async function verifyArtifact(c: BackupConfig, m: Manifest, id: string) {
  const path = artifact(c, id);
  if (
    m.id !== id ||
    (await stat(path)).size !== m.size ||
    (await checksum(path)) !== m.sha256
  )
    throw new BackupFailure("backup_checksum_failed");
  try {
    await pipeline(createReadStream(path), decrypt(c, m), discard());
  } catch {
    throw new BackupFailure("backup_decryption_failed");
  }
  const { p, done } = child(c, "pg_restore", ["--list"]);
  p.stdout.resume();
  try {
    await Promise.all([
      pipeline(createReadStream(path), decrypt(c, m), p.stdin),
      done,
    ]);
  } catch {
    p.kill();
    throw new BackupFailure("backup_archive_invalid");
  }
  return m;
}
export function retainedIds(manifests: Manifest[]) {
  const sorted = [...manifests].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
  const days = new Set<string>(),
    keep = new Set<string>();
  for (const m of sorted) {
    const day = m.created_at.slice(0, 10);
    if (days.size < 7 && !days.has(day)) {
      days.add(day);
      keep.add(m.id);
    }
  }
  // Retain the newest point from the previous calendar month, or the oldest
  // available month while the installation accumulates history.
  const month = sorted[0]?.created_at.slice(0, 7);
  const monthly =
    sorted.find((m) => m.created_at.slice(0, 7) !== month) ?? sorted.at(-1);
  if (monthly) keep.add(monthly.id);
  return keep;
}
async function retain(c: BackupConfig, current: string) {
  const manifests: Manifest[] = [];
  for (const file of await readdir(c.directory))
    if (/^[a-f0-9-]{36}\.json$/.test(file)) {
      // Never prune a corrupt/unknown artifact automatically.
      try {
        manifests.push(await verifyBackup(c, file.slice(0, -5)));
      } catch {
        /* Preserve evidence. */
      }
    }
  const keep = retainedIds(manifests);
  keep.add(current);
  for (const m of manifests)
    if (!keep.has(m.id)) {
      await unlink(artifact(c, m.id));
      await unlink(join(c.directory, `${m.id}.json`));
    }
}
export async function createBackup(c: BackupConfig, now = new Date()) {
  await privateDirectory(c.directory);
  const lockPath = join(c.directory, "backup.lock");
  await writeFile(lockPath, JSON.stringify({ started_at: now.toISOString() }), {
    flag: "wx",
    mode: 0o600,
  }).catch(() => {
    throw new BackupFailure("backup_locked_review_interrupted_run");
  });
  const client = new pg.Client({
    connectionString: c.database,
    connectionTimeoutMillis: 10000,
  });
  const id = randomUUID(),
    temp = join(c.directory, `${id}.partial`),
    path = artifact(c, id);
  try {
    await client.connect();
    await client.query("begin isolation level repeatable read read only");
    const schema = (
      await client.query<{ schema_version: number }>(
        "select schema_version from foundation_metadata where id=1",
      )
    ).rows[0]?.schema_version;
    if (schema !== 12 && schema !== 13)
      throw new BackupFailure("backup_schema_incompatible");
    const snapshot = (
      await client.query<{ snapshot: string }>(
        "select pg_export_snapshot() snapshot",
      )
    ).rows[0]!.snapshot;
    const tables = (
      await client.query<{ tablename: string }>(
        "select tablename from pg_tables where schemaname='public' order by tablename",
      )
    ).rows;
    const counts: Record<string, string> = {};
    for (const { tablename } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename))
        throw new BackupFailure("backup_schema_incompatible");
      counts[tablename] = (
        await client.query<{ n: string }>(
          `select count(*) n from public."${tablename}"`,
        )
      ).rows[0]!.n;
    }
    const base = metadata.parse({
      id,
      created_at: now.toISOString(),
      schema,
      schema_hash: await schemaHash(client),
      format: "pg-custom-aes256gcm-v1",
      counts,
      key_version: c.keyVersion,
    });
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", c.key, iv);
    cipher.setAAD(aad(base));
    const { p, done } = child(c, "pg_dump", [
      "--format=custom",
      "--no-owner",
      "--no-acl",
      `--snapshot=${snapshot}`,
    ]);
    p.stdin.end();
    try {
      await Promise.all([
        pipeline(
          p.stdout,
          cipher,
          createWriteStream(temp, { flags: "wx", mode: 0o600 }),
        ),
        done,
      ]);
    } catch {
      p.kill();
      throw new BackupFailure("backup_dump_failed");
    }
    await client.query("commit");
    const m = manifestSchema.parse({
      ...base,
      size: (await stat(temp)).size,
      sha256: await checksum(temp),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      verified: true,
    });
    await rename(temp, path);
    const manifestPath = join(c.directory, `${id}.json`);
    await writeFile(`${manifestPath}.partial`, JSON.stringify(m), {
      flag: "wx",
      mode: 0o600,
    });
    await verifyArtifact(c, m, id);
    await rename(`${manifestPath}.partial`, manifestPath);
    await retain(c, id);
    await writeFile(
      join(c.directory, "last-backup.json"),
      JSON.stringify({
        id,
        completed_at: new Date().toISOString(),
        status: "verified",
      }),
      { mode: 0o600 },
    );
    return m;
  } finally {
    await client.end().catch(() => undefined);
    await unlink(lockPath);
  }
}
export async function restoreCheck(
  c: BackupConfig,
  id: string,
  vault?: KeyVault,
  preserveQuarantined = false,
) {
  await privateDirectory(c.directory);
  const started = Date.now(),
    m = await verifyBackup(c, id),
    u = new URL(c.database);
  if (!["127.0.0.1", "localhost"].includes(u.hostname))
    throw new BackupFailure("restore_requires_isolated_local_postgres");
  const target = `axis_restore_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({
    connectionString: c.database,
    connectionTimeoutMillis: 10000,
  });
  let created = false,
    preserved = false,
    db: pg.Client | undefined;
  let result:
    | {
        backup_id: string;
        timestamp: string;
        status: string;
        duration_ms: number;
        schema: number;
        credentials_verified: number | null;
        database?: string;
        quarantined?: boolean;
      }
    | undefined;
  try {
    await admin.connect();
    await admin.query(`create database "${target}" template template0`);
    created = true;
    u.pathname = `/${target}`;
    const { p, done } = child(
      c,
      "pg_restore",
      ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", target],
      u.href,
    );
    p.stdout.resume();
    try {
      await Promise.all([
        pipeline(createReadStream(artifact(c, id)), decrypt(c, m), p.stdin),
        done,
      ]);
    } catch {
      p.kill();
      throw new BackupFailure("restore_tool_failed");
    }
    db = new pg.Client({
      connectionString: u.href,
      connectionTimeoutMillis: 10000,
    });
    await db.connect();
    const schema = (
      await db.query<{ schema_version: number }>(
        "select schema_version from foundation_metadata where id=1",
      )
    ).rows[0]?.schema_version;
    if (schema !== m.schema) throw new BackupFailure("restore_schema_mismatch");
    if ((await schemaHash(db)) !== m.schema_hash)
      throw new BackupFailure("restore_schema_objects_mismatch");
    const migrations = await db.query(
      "select name from kysely_migration where name='012-calendar'",
    );
    if (migrations.rowCount !== 1)
      throw new BackupFailure("restore_migration_missing");
    for (const [table, count] of Object.entries(m.counts))
      if (
        (
          await db.query<{ n: string }>(
            `select count(*) n from public."${table}"`,
          )
        ).rows[0]?.n !== count
      )
        throw new BackupFailure("restore_record_count_mismatch");
    const invalid = await db.query(
      "select 1 from pg_constraint where connamespace='public'::regnamespace and not convalidated union all select 1 from pg_index i join pg_class c on c.oid=i.indexrelid where c.relnamespace='public'::regnamespace and not i.indisvalid",
    );
    if (invalid.rowCount)
      throw new BackupFailure("restore_constraints_invalid");
    const credentials = await db.query<{
      user_id: string;
      provider: string;
      secret: unknown;
    }>(
      "select user_id,provider,encrypted_key secret from ai_configs union all select user_id,'google-calendar',credential from calendar_connections where credential is not null",
    );
    if (credentials.rowCount && !vault)
      throw new BackupFailure("restore_application_keys_required");
    for (const row of credentials.rows)
      vault!.decrypt(row.secret, row.user_id, row.provider);
    if (preserveQuarantined) {
      await db.query("begin");
      await db.query("update recovery_control set quarantined=true where id=1");
      await db.query("delete from sessions");
      await db.query("delete from oauth_challenges");
      await db.query("delete from calendar_challenges");
      if (m.schema >= 13) {
        // A snapshot cannot prove which commands/replies ran after it was taken.
        await db.query(
          "update telegram_commands set status='unknown',input='',lease_until=null where status in ('queued','processing')",
        );
        await db.query(
          "update telegram_command_replies set status='unknown',lease_until=null where status in ('queued','sending')",
        );
        await db.query(
          "update telegram_command_proposals set link_revision=gen_random_uuid()",
        );
      }
      await db.query("commit");
    }
    result = {
      backup_id: id,
      timestamp: new Date().toISOString(),
      status: "passed",
      duration_ms: Date.now() - started,
      schema,
      credentials_verified: credentials.rowCount,
      ...(preserveQuarantined ? { database: target, quarantined: true } : {}),
    };
    preserved = preserveQuarantined;
  } finally {
    await db?.end().catch(() => undefined);
    // Only the freshly-created UUID database can reach this deletion.
    try {
      if (created && !preserved) await admin.query(`drop database "${target}"`);
    } finally {
      await admin.end();
    }
  }
  if (!result) throw new BackupFailure("restore_incomplete");
  result.duration_ms = Date.now() - started;
  await writeFile(
    join(c.directory, "last-restore.json"),
    JSON.stringify(result),
    { mode: 0o600 },
  );
  return result;
}
