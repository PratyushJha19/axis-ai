import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  backupConfig,
  retainedIds,
  type Manifest,
} from "../../scripts/backup-lib.js";
test("backup config fails closed without key or with public storage", () => {
  assert.throws(() => backupConfig({}));
  assert.throws(() =>
    backupConfig({
      DATABASE_URL: "postgres://fixture@localhost/test",
      BACKUP_DIRECTORY: "relative",
    }),
  );
});
test("retention keeps seven distinct recent days and an older monthly point", () => {
  const rows: Manifest[] = Array.from({ length: 12 }, (_, i) => ({
    id: randomUUID(),
    created_at: new Date(Date.UTC(2026, 9, 20 - i)).toISOString(),
    schema: 12,
    schema_hash: "0".repeat(64),
    format: "pg-custom-aes256gcm-v1",
    counts: {},
    key_version: "v1",
    size: 1,
    sha256: "0".repeat(64),
    iv: "",
    tag: "",
    verified: true,
  }));
  const monthly = {
    ...rows[0]!,
    id: randomUUID(),
    created_at: "2026-09-30T00:00:00.000Z",
  };
  rows.push(monthly);
  const duplicate = {
    ...rows[0]!,
    id: randomUUID(),
    created_at: "2026-10-20T01:00:00.000Z",
  };
  rows.push(duplicate);
  const keep = retainedIds(rows);
  assert.equal(keep.size, 8);
  assert.ok(keep.has(monthly.id));
  assert.ok(keep.has(duplicate.id));
  assert.ok(!keep.has(rows[0]!.id));
  assert.equal(retainedIds([rows[0]!]).size, 1);
});
