import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { canvasSchema } from "../../packages/shared/src/canvas.js";

test("canvas input rejects injected ownership, duplicate nodes and dangling edges", () => {
  const node = {
    id: randomUUID(),
    kind: "Idea",
    title: "Example",
    content: "",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    task_id: null,
  };
  const value = {
    name: "Map",
    project_id: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [node],
    edges: [],
  };
  assert.ok(canvasSchema.safeParse(value).success);
  assert.equal(
    canvasSchema.safeParse({ ...value, user_id: randomUUID() }).success,
    false,
  );
  assert.equal(
    canvasSchema.safeParse({ ...value, nodes: [node, node] }).success,
    false,
  );
  assert.equal(
    canvasSchema.safeParse({
      ...value,
      edges: [
        {
          id: randomUUID(),
          source: node.id,
          target: randomUUID(),
          label: "Related",
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    canvasSchema.safeParse({
      ...value,
      viewport: { x: Infinity, y: 0, zoom: 1 },
    }).success,
    false,
  );
  assert.equal(
    canvasSchema.safeParse({
      ...value,
      nodes: Array.from({ length: 101 }, () => ({ ...node, id: randomUUID() })),
    }).success,
    false,
  );
});
