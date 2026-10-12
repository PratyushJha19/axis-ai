import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  unlink,
  rmdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("AI setup creates a random key without printing it, preserves unrelated settings and existing keys", async () => {
  const parent = resolve(".local");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "ai-setup-test-"));
  const scripts = join(root, "scripts"),
    script = join(scripts, "configure-ai.mjs"),
    env = join(root, ".env");
  await mkdir(scripts);
  await copyFile("scripts/configure-ai.mjs", script);
  try {
    await writeFile(
      env,
      "UNRELATED=synthetic\nAI_CREDENTIALS_ENCRYPTION_KEY=\nNEXT=preserved\n",
    );
    const run = await promisify(execFile)(process.execPath, [script]);
    const content = await readFile(env, "utf8"),
      key = content.match(/^AI_CREDENTIALS_ENCRYPTION_KEY=(.+)$/m)?.[1];
    assert.ok(key);
    assert.equal(Buffer.from(key, "base64").length, 32);
    assert.match(content, /UNRELATED=synthetic/);
    assert.match(content, /NEXT=preserved/);
    assert.ok(!run.stdout.includes(key));
    assert.equal(run.stderr, "");
    await promisify(execFile)(process.execPath, [script]);
    assert.equal(await readFile(env, "utf8"), content);
  } finally {
    await unlink(env);
    await unlink(script);
    await rmdir(scripts);
    await rmdir(root);
  }
});
