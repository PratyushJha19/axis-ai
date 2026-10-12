import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Dedicated local smoke command: never prints inherited environment or child errors.
const children: ReturnType<typeof spawn>[] = [];
function start(path: string) {
  const child = spawn(process.execPath, ["--import", "tsx", path], {
    env: { ...process.env, PORT: "33017" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(child);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-10000);
  });
  child.stderr?.on("data", () => undefined);
  return { child, output: () => output };
}

try {
  const api = start("services/api/src/main.ts");
  const worker = start("services/worker/src/main.ts");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      api.output().includes("api_started") &&
      worker.output().includes("worker_dependency_ready")
    )
      break;
    assert.equal(api.child.exitCode, null, "API startup failed");
    assert.equal(worker.child.exitCode, null, "Worker startup failed");
    await delay(100);
  }
  assert.ok(
    api.output().includes("api_started"),
    "API startup deadline exceeded",
  );
  assert.ok(
    worker.output().includes("worker_dependency_ready"),
    "Worker readiness deadline exceeded",
  );
  for (const path of ["live", "ready"]) {
    const response = await fetch(`http://127.0.0.1:33017/health/${path}`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
  }
  console.log(
    "PASS: API startup, live/ready HTTP, and independent worker database readiness.",
  );
} finally {
  for (const child of children) child.kill();
}
