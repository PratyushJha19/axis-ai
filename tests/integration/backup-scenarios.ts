import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { sql } from "kysely";
import pg from "pg";
import {
  createDatabase,
  checkDatabase,
} from "../../packages/database/src/index.js";
import { createMigrator } from "../../database/scripts/migrator.js";
import {
  createBackup,
  verifyBackup,
  restoreCheck,
  type BackupConfig,
} from "../../scripts/backup-lib.js";
import { KeyVault } from "../../packages/domain/src/ai-crypto.js";
import { saveReminder } from "../../packages/domain/src/reminders.js";
export async function backupScenarios(t: TestContext, connection: string) {
  const name = `axis_test_backup_${randomUUID().replaceAll("-", "")}`,
    admin = new pg.Client({ connectionString: connection });
  await admin.connect();
  const existingRestores = (
    await admin.query(
      "select datname from pg_database where datname like 'axis_restore_%'",
    )
  ).rowCount;
  const url = new URL(connection);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  await admin.query(`create database "${name}" template template0`);
  url.pathname = `/${name}`;
  const db = createDatabase(url.href),
    directory = resolve(".local", `backup-test-${randomUUID()}`);
  const key = randomBytes(32),
    vault = new KeyVault(new Map([["test", key]]), "test");
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform === "win32")
      await promisify(execFile)(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:AXIS_TEST_BACKUP; $acl.SetAccessRuleProtection($true,$false); $who=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($r); Set-Acl -LiteralPath $env:AXIS_TEST_BACKUP -AclObject $acl",
        ],
        {
          env: {
            ...process.env,
            PSModulePath: `${process.env.SystemRoot || "C:/Windows"}/System32/WindowsPowerShell/v1.0/Modules`,
            AXIS_TEST_BACKUP: directory,
          },
          windowsHide: true,
        },
      );
    const config: BackupConfig = {
      directory,
      database: url.href,
      pgBin:
        process.env.PG_BIN ||
        (process.platform === "win32"
          ? "C:/Program Files/PostgreSQL/18/bin"
          : ""),
      key: randomBytes(32),
      keyVersion: "test",
    };
    const migration = await createMigrator(db).migrateToLatest();
    assert.equal(migration.error, undefined);
    const owner = randomUUID(),
      task = randomUUID();
    await sql`insert into users(id,google_subject,email,display_name,timezone) values(${owner},${owner},'restore@example.invalid','Restore fixture','UTC')`.execute(
      db,
    );
    await sql`insert into tasks(id,user_id,title) values(${task},${owner},'Synthetic restore task')`.execute(
      db,
    );
    await sql`insert into ai_configs(id,user_id,provider,model,encrypted_key,version) values(${randomUUID()},${owner},'groq','fixture',${JSON.stringify(vault.encrypt("synthetic-provider-key", owner, "groq"))}::jsonb,${randomUUID()})`.execute(
      db,
    );
    const project = randomUUID();
    await sql`insert into projects(id,user_id,name) values(${project},${owner},'Restore project')`.execute(
      db,
    );
    await sql`update tasks set project_id=${project} where id=${task}`.execute(
      db,
    );
    await sql`insert into memory_items(id,user_id,content,kind,scope,truth_status,sensitivity) values(${randomUUID()},${owner},'Synthetic restore memory','fact','global','confirmed','ordinary')`.execute(
      db,
    );
    const reminder = await saveReminder(
      db,
      owner,
      {
        title: "Restore reminder",
        task_id: task,
        project_id: project,
        local_due: "2099-10-20T10:00",
        timezone: "UTC",
        confirmed: true,
      },
      owner,
      { key: randomUUID() },
    );
    await sql`insert into calendar_connections(user_id,revision,subject,credential,scopes,status) values(${owner},${randomUUID()},${owner},${JSON.stringify(vault.encrypt("synthetic-calendar-key", owner, "google-calendar"))}::jsonb,array[]::text[],'connected')`.execute(
      db,
    );
    await sql`insert into sessions(sid,sess,expire) values('synthetic-restored-session','{}'::json,now()+interval '1 day')`.execute(
      db,
    );
    let id = "";
    await t.test(
      "real PostgreSQL backup is encrypted, checksummed, readable and restores records and credentials in isolation",
      async () => {
        const m = await createBackup(config);
        id = m.id;
        assert.equal(m.counts.tasks, "1");
        assert.equal(m.counts.users, "1");
        assert.equal(m.counts.projects, "1");
        assert.equal(m.counts.reminders, "1");
        assert.equal(m.counts.memory_items, "1");
        const bytes = await readFile(join(directory, `${id}.axisbackup`));
        assert.ok(!bytes.includes(Buffer.from("Synthetic restore task")));
        assert.ok(!bytes.includes(Buffer.from("synthetic-provider-key")));
        assert.equal((await verifyBackup(config, id)).sha256, m.sha256);
        const result = await restoreCheck(config, id, vault);
        assert.equal(result.status, "passed");
        assert.equal(result.credentials_verified, 2);
        assert.equal(
          (
            await admin.query(
              "select datname from pg_database where datname like 'axis_restore_%'",
            )
          ).rowCount,
          existingRestores,
        );
        assert.equal(
          (await sql`select id from tasks where id=${task}`.execute(db)).rows
            .length,
          1,
        );
      },
    );
    await t.test(
      "restore rejects tampering, wrong keys and absent application keys without changing source",
      async () => {
        await assert.rejects(
          verifyBackup({ ...config, key: randomBytes(32) }, id),
        );
        await assert.rejects(restoreCheck(config, id));
        const path = join(directory, `${id}.axisbackup`),
          bytes = await readFile(path),
          bad = Buffer.from(bytes);
        bad[0] = bad[0]! ^ 1;
        await writeFile(path, bad);
        await assert.rejects(restoreCheck(config, id, vault));
        await writeFile(path, bytes);
        assert.equal(
          (await sql`select id from tasks where id=${task}`.execute(db)).rows
            .length,
          1,
        );
        assert.equal(
          (
            await admin.query(
              "select datname from pg_database where datname like 'axis_restore_%'",
            )
          ).rowCount,
          existingRestores,
        );
      },
    );
    await t.test(
      "failed/interrupted backup preserves the verified recovery point; quarantine blocks service readiness",
      async () => {
        await writeFile(join(directory, "backup.lock"), "interrupted", {
          flag: "wx",
        });
        await assert.rejects(createBackup(config));
        await unlink(join(directory, "backup.lock"));
        const unavailable = new URL(config.database);
        unavailable.port = "1";
        await assert.rejects(
          createBackup({ ...config, database: unavailable.href }),
        );
        await assert.rejects(
          createBackup({ ...config, key: Buffer.alloc(16) }),
        );
        const storageFile = join(directory, "not-a-directory");
        await writeFile(storageFile, "fixture");
        await assert.rejects(
          createBackup({ ...config, directory: storageFile }),
        );
        await assert.rejects(
          createBackup({
            ...config,
            pgBin: resolve(directory, "missing-tools"),
          }),
        );
        assert.equal((await verifyBackup(config, id)).id, id);
        assert.ok((await readdir(directory)).includes(`${id}.json`));
        await sql`update recovery_control set quarantined=true where id=1`.execute(
          db,
        );
        await assert.rejects(checkDatabase(db));
        await sql`update foundation_metadata set schema_version=11 where id=1`.execute(
          db,
        );
        try {
          await assert.rejects(createBackup(config));
        } finally {
          await sql`update foundation_metadata set schema_version=12 where id=1`.execute(
            db,
          );
        }
      },
    );
    await t.test(
      "operator restore quarantines post-snapshot reminder/task uncertainty, clears sessions and never replaces the source",
      async () => {
        // Synthetic stand-ins for externally delivered work and a task completed
        // after the snapshot. Restoring cannot know or reverse those later facts.
        await sql`update reminders set status='sent',next_attempt_at=null where id=${reminder.id}`.execute(
          db,
        );
        await sql`update tasks set status='completed',completion_at=now() where id=${task}`.execute(
          db,
        );
        const restored = await restoreCheck(config, id, vault, true);
        assert.match(restored.database!, /^axis_restore_[a-f0-9]{32}$/);
        const targetUrl = new URL(config.database);
        targetUrl.pathname = `/${restored.database}`;
        const target = createDatabase(targetUrl.href);
        try {
          await assert.rejects(checkDatabase(target));
          assert.equal(
            (
              await sql<{
                status: string;
              }>`select status from reminders where id=${reminder.id}`.execute(
                target,
              )
            ).rows[0]!.status,
            "scheduled",
          );
          assert.equal(
            (
              await sql<{
                status: string;
              }>`select status from tasks where id=${task}`.execute(target)
            ).rows[0]!.status,
            "inbox",
          );
          assert.equal(
            (await sql`select sid from sessions`.execute(target)).rows.length,
            0,
          );
          assert.equal(
            (
              await sql`select id from reminders where id=${reminder.id} and task_id=${task} and project_id=${project}`.execute(
                target,
              )
            ).rows.length,
            1,
          );
          assert.equal(
            (await sql`select id from tasks where id=${task}`.execute(target))
              .rows.length,
            1,
          );
        } finally {
          await target.destroy();
          await admin.query(`drop database "${restored.database}"`);
        }
        assert.equal(
          (await sql`select id from tasks where id=${task}`.execute(db)).rows
            .length,
          1,
        );
      },
    );
  } finally {
    await db.destroy();
    await admin.query(`drop database "${name}"`);
    await admin.end();
  }
}
