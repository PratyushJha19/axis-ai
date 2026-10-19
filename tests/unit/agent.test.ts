import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAgentDecision,
  agentLimitsSchema,
  boundedReadTool,
} from "../../services/worker/src/agent-runtime.js";
import {
  agentTools,
  resolveAgentTool,
} from "../../packages/domain/src/agent-tools.js";
test("agent protocol is strict, bounded, and never treats model authorization as authority", () => {
  assert.equal(
    parseAgentDecision('{"kind":"final","message":"Hello"}').kind,
    "final",
  );
  assert.throws(() => parseAgentDecision("I created it"));
  assert.throws(() =>
    parseAgentDecision('{"kind":"final","message":"done","approved":true}'),
  );
  assert.throws(() => parseAgentDecision("x".repeat(16001)));
  assert.throws(() => agentLimitsSchema.parse({ iterations: 1000 }));
  assert.throws(() =>
    resolveAgentTool("fetch_url", { url: "http://127.0.0.1" }),
  );
  assert.throws(() => resolveAgentTool("search_tasks", { user_id: "other" }));
  assert.throws(() =>
    resolveAgentTool("create_task", { title: "x", approved: true }),
  );
  assert.throws(() =>
    resolveAgentTool("create_reminder", { title: "missing time" }),
  );
  assert.equal(agentTools.get("create_task")?.risk, "B");
  assert.equal(agentTools.get("search_memory")?.readOnly, true);
  assert.ok(
    [...agentTools.values()].every(
      (t) =>
        t.enabled && typeof t.execute === "function" && t.timeoutMs <= 2000,
    ),
  );
});
test("read tool deadlines are bounded and disabled tools are denied", async () => {
  await assert.rejects(boundedReadTool(new Promise(() => undefined), 10), {
    code: "TOOL_TIMEOUT",
  });
  const definition = agentTools.get("get_task")!;
  definition.enabled = false;
  try {
    assert.throws(
      () =>
        resolveAgentTool("get_task", {
          id: "00000000-0000-4000-8000-000000000000",
        }),
      { code: "UNSUPPORTED_TOOL" },
    );
  } finally {
    definition.enabled = true;
  }
});
