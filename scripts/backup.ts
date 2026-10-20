import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  backupConfig,
  createBackup,
  verifyBackup,
  restoreCheck,
  privateDirectory,
  BackupFailure,
} from "./backup-lib.js";
import { readAIConfig } from "../packages/domain/src/ai-crypto.js";
import { z } from "zod";
const operation = process.argv[2] || "create";
try {
  const config = backupConfig();
  await privateDirectory(config.directory);
  const id = process.argv[3];
  if (operation === "create") {
    const m = await createBackup(config);
    console.log(
      JSON.stringify({
        event: "backup_verified",
        id: m.id,
        schema: m.schema,
        size: m.size,
      }),
    );
  } else if (["verify", "restore-check", "restore-new"].includes(operation)) {
    if (
      operation === "restore-new" &&
      (!id || process.argv[4] !== "--confirm-new-isolated-database")
    )
      throw new BackupFailure("restore_new_requires_explicit_confirmation");
    const selected =
      id ||
      (
        JSON.parse(
          await readFile(join(config.directory, "last-backup.json"), "utf8"),
        ) as { id: string }
      ).id;
    const result =
      operation === "verify"
        ? await verifyBackup(config, selected)
        : await restoreCheck(
            config,
            selected,
            readAIConfig()?.vault,
            operation === "restore-new",
          );
    console.log(
      JSON.stringify({
        event: operation === "verify" ? "backup_verified" : "restore_verified",
        id: selected,
        ...("duration_ms" in result ? { duration_ms: result.duration_ms } : {}),
        ...("database" in result
          ? { database: result.database, quarantined: true }
          : {}),
      }),
    );
  } else if (operation === "health") {
    const backup = z
      .object({
        id: z.uuid(),
        completed_at: z.iso.datetime(),
        status: z.literal("verified"),
      })
      .parse(
        JSON.parse(
          await readFile(join(config.directory, "last-backup.json"), "utf8"),
        ),
      );
    const restore = z
      .object({ timestamp: z.iso.datetime(), status: z.literal("passed") })
      .parse(
        JSON.parse(
          await readFile(join(config.directory, "last-restore.json"), "utf8"),
        ),
      );
    if (
      Date.now() - Date.parse(backup.completed_at) > 86400000 ||
      Date.now() - Date.parse(restore.timestamp) > 32 * 86400000 ||
      restore.status !== "passed"
    )
      throw new BackupFailure("backup_or_restore_overdue");
    await verifyBackup(config, backup.id);
    console.log(JSON.stringify({ event: "backup_health_ok" }));
  } else throw new BackupFailure("backup_operation_invalid");
} catch (e) {
  const result = {
    event: "backup_operation_failed",
    operation,
    reason: e instanceof BackupFailure ? e.code : "operation_failed",
    timestamp: new Date().toISOString(),
  };
  console.error(JSON.stringify(result));
  process.exitCode = 1;
  try {
    const c = backupConfig();
    await privateDirectory(c.directory);
    await writeFile(
      join(c.directory, "last-failure.json"),
      JSON.stringify(result),
      { mode: 0o600 },
    );
  } catch {
    /* Stderr and nonzero exit remain available when storage fails. */
  }
}
