import assert from "node:assert/strict";
import test from "node:test";
import { runProcessGroup } from "../../scripts/process-group.js";

test(
  "free host stops and reaps the surviving service when either child exits",
  { timeout: 10000 },
  async () => {
    const alive = ["-e", "setInterval(() => {}, 1000)"];
    for (const commands of [
      [alive, ["-e", "process.exit(1)"]],
      [["-e", "process.exit(0)"], alive],
    ])
      assert.equal(await runProcessGroup(commands, undefined, 100), 1);
  },
);

test(
  "free host shutdown waits for children and handles cancellation before startup",
  { timeout: 10000 },
  async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      assert.equal(
        await runProcessGroup(
          [
            ["-e", "setInterval(() => {}, 1000)"],
            ["-e", "setInterval(() => {}, 1000)"],
          ],
          controller.signal,
          100,
        ),
        0,
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(
      await runProcessGroup([["-e", "process.exit(1)"]], controller.signal),
      0,
    );
  },
);
