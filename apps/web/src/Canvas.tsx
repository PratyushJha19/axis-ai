import { useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeResizer,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  ListTodo,
  MousePointerClick,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Trash2,
  Undo2,
  Unlink,
  Workflow,
} from "lucide-react";
import {
  canvasKinds,
  type Canvas,
  type CanvasInput,
} from "../../../packages/shared/src/canvas";
import type { Task } from "../../../packages/shared/src/contracts";
import { api } from "./api";

type Card = Node<{ label: string; kind: string }>;
function CanvasCard({ data, selected }: NodeProps<Card>) {
  return (
    <div className={`canvas-card kind-${data.kind.toLowerCase()}`}>
      <NodeResizer minWidth={140} minHeight={80} isVisible={selected} />
      <Handle type="target" position={Position.Left} />
      <small>{data.kind}</small>
      <strong>{data.label}</strong>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { card: CanvasCard };
// Server row order is not an edit; compare graphs independently of SQL ordering.
const serialize = (value: CanvasInput) =>
  JSON.stringify({
    ...value,
    nodes: [...value.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...value.edges].sort((a, b) => a.id.localeCompare(b.id)),
  });
const blank = (projectId?: string): CanvasInput => ({
  name: "Untitled canvas",
  project_id: projectId || null,
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
});
const templates: Record<string, string[]> = {
  Blank: [],
  "Mind map": ["Central idea", "First branch", "Second branch"],
  "Project breakdown": ["Project goal", "Research", "Build", "Review"],
  "Product roadmap": ["Now", "Next", "Later"],
  "Research map": [
    "Research question",
    "Sources",
    "Findings",
    "Open questions",
  ],
  Workflow: ["Start", "Do the work", "Review", "Finish"],
  "Decision tree": ["Decision", "Option A", "Option B"],
};
export function CanvasPage({
  projectId,
  onTask,
  onDirty,
  refresh: taskRefresh = 0,
}: {
  projectId?: string;
  onTask: (task: Task) => void;
  onDirty?: (dirty: boolean) => void;
  refresh?: number;
}) {
  const [list, setList] = useState<Canvas[]>([]),
    [selected, setSelected] = useState<Canvas | null>(null),
    [error, setError] = useState("");
  const [template, setTemplate] = useState("Blank");
  const [offset, setOffset] = useState(0),
    [more, setMore] = useState(false),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api<{ items: Canvas[]; hasMore: boolean }>(
      `/canvases?offset=${offset}${projectId ? `&project_id=${projectId}` : ""}`,
    )
      .then((p) => {
        if (alive) {
          setList(p.items);
          setMore(p.hasMore);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId, offset, refresh]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const draft = blank(projectId);
      if (template !== "Blank") {
        draft.name = template;
        draft.nodes = templates[template]!.map((title, index) => ({
          id: crypto.randomUUID(),
          kind: index ? "Idea" : "Goal",
          title,
          content: "",
          x: index ? 320 : 20,
          y: index ? index * 150 : 150,
          width: 200,
          height: 100,
          task_id: null,
        }));
        draft.edges = draft.nodes.slice(1).map((n) => ({
          id: crypto.randomUUID(),
          source: draft.nodes[0]!.id,
          target: n.id,
          label: "Related",
        }));
      }
      setSelected(
        await api<Canvas>(`/canvases/${crypto.randomUUID()}`, {
          method: "PUT",
          body: JSON.stringify(draft),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (selected)
    return (
      <CanvasEditor
        key={selected.id}
        initial={selected}
        refresh={taskRefresh}
        onTask={onTask}
        onDirty={onDirty}
        onBack={() => {
          setSelected(null);
          setRefresh((n) => n + 1);
          onDirty?.(false);
        }}
      />
    );
  return (
    <section className="canvas-home">
      <div className="panel canvas-new">
        <div className="canvas-new-copy">
          <span className="eyebrow">VISUAL THINKING</span>
          <h2>Start a canvas</h2>
          <p>
            Map ideas, connect them, and turn them into tasks. Lines are visual
            relationships; they do not change task dependencies.
          </p>
        </div>
        <div
          className="canvas-templates"
          role="group"
          aria-label="Starting template"
        >
          {Object.keys(templates).map((name) => (
            <button
              key={name}
              aria-pressed={template === name}
              className={template === name ? "selected" : ""}
              onClick={() => setTemplate(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void create()}
        >
          <Plus size={15} /> New canvas
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {list.length ? (
        <div className="canvas-grid">
          {list.map((c) => (
            <button
              key={c.id}
              className="canvas-tile"
              onClick={() => {
                api<Canvas>(`/canvases/${c.id}`)
                  .then(setSelected)
                  .catch((e) => setError(e.message));
              }}
            >
              <span className="canvas-tile-top">
                <span className="mini-card-icon" aria-hidden="true">
                  <Workflow size={15} />
                </span>
                <small>
                  Edited{" "}
                  {new Date(c.updated_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </small>
              </span>
              <h3>{c.name}</h3>
              <small className="canvas-tile-open">Open canvas →</small>
            </button>
          ))}
        </div>
      ) : (
        <div className="approvals-empty">
          <Workflow size={22} />
          <strong>No canvases yet.</strong>
          <span>Pick a template above and start mapping your ideas.</span>
        </div>
      )}
      {(offset > 0 || more) && (
        <div className="pagination">
          <button disabled={!offset} onClick={() => setOffset((n) => n - 30)}>
            Previous
          </button>
          <button disabled={!more} onClick={() => setOffset((n) => n + 30)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
function CanvasEditor({
  initial,
  onBack,
  onTask,
  onDirty,
  refresh,
}: {
  initial: Canvas;
  onBack: () => void;
  onTask: (t: Task) => void;
  onDirty?: (dirty: boolean) => void;
  refresh: number;
}) {
  const { id, version: initialVersion, ...rest } = initial;
  const [data, setData] = useState<CanvasInput>(() => ({
    name: rest.name,
    project_id: rest.project_id,
    viewport: rest.viewport,
    nodes: rest.nodes,
    edges: rest.edges,
  }));
  const current = useRef(data),
    version = useRef(initialVersion),
    lastSaved = useRef(serialize(data)),
    saving = useRef(false);
  const [status, setStatus] = useState("Saved"),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [undo, setUndo] = useState<CanvasInput[]>([]),
    [redo, setRedo] = useState<CanvasInput[]>([]),
    [search, setSearch] = useState(""),
    [tasks, setTasks] = useState<Record<string, Task>>({});
  const [tick, setTick] = useState(0);
  const dirty = serialize(data) !== lastSaved.current;
  function change(next: CanvasInput, history = true) {
    if (history) {
      setUndo((u) => [...u.slice(-49), current.current]);
      setRedo([]);
    }
    current.current = next;
    setData(next);
    setError("");
    setStatus("Unsaved");
  }
  async function save(): Promise<boolean> {
    if (saving.current) return false;
    const snapshot = current.current,
      serialized = serialize(snapshot);
    if (serialized === lastSaved.current) return true;
    saving.current = true;
    setStatus("Saving…");
    try {
      const result = await api<Canvas>(`/canvases/${id}`, {
        method: "PUT",
        headers: { "If-Match": String(version.current) },
        body: serialized,
      });
      version.current = result.version;
      lastSaved.current = serialized;
      setError("");
      setStatus(
        serialize(current.current) === serialized ? "Saved" : "Unsaved",
      );
      return true;
    } catch (e) {
      setError((e as Error).message);
      setStatus("Save failed — draft kept here");
      return false;
    } finally {
      saving.current = false;
      setTick((n) => n + 1);
    }
  }
  useEffect(() => {
    onDirty?.(dirty);
    const warn = (e: BeforeUnloadEvent) => {
      if (serialize(current.current) !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty || error) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [data, tick, error]);
  useEffect(() => {
    let alive = true;
    const ids = [
      ...new Set(data.nodes.flatMap((n) => (n.task_id ? [n.task_id] : []))),
    ];
    Promise.all(
      ids.map(async (taskId) => {
        try {
          return await api<Task>(`/tasks/${taskId}`);
        } catch {
          return null;
        }
      }),
    ).then((rows) => {
      if (alive)
        setTasks(
          Object.fromEntries(
            rows.filter((r): r is Task => r !== null).map((r) => [r.id, r]),
          ),
        );
    });
    return () => {
      alive = false;
    };
  }, [data.nodes.map((n) => n.task_id).join(","), refresh]);
  const node = data.nodes.find((n) => n.id === selected),
    edge = data.edges.find((e) => e.id === selectedEdge);
  const nodes: Card[] = data.nodes.map((n) => ({
    id: n.id,
    type: "card",
    position: { x: n.x, y: n.y },
    width: n.width,
    height: n.height,
    selected: n.id === selected,
    style: {
      width: n.width,
      height: n.height,
      opacity:
        search && !n.title.toLowerCase().includes(search.toLowerCase())
          ? 0.3
          : 1,
    },
    data: {
      kind: n.kind,
      label: n.task_id
        ? tasks[n.task_id]
          ? `${tasks[n.task_id]!.title} · ${tasks[n.task_id]!.status}`
          : "Linked task unavailable"
        : n.title,
    },
  }));
  function add(kind: CanvasInput["nodes"][number]["kind"]) {
    const nodeId = crypto.randomUUID();
    change({
      ...data,
      nodes: [
        ...data.nodes,
        {
          id: nodeId,
          kind,
          title: `New ${kind.toLowerCase()}`,
          content: "",
          x: (200 - data.viewport.x) / data.viewport.zoom,
          y: (150 - data.viewport.y) / data.viewport.zoom,
          width: 200,
          height: 100,
          task_id: null,
        },
      ],
    });
    setSelected(nodeId);
    setSelectedEdge(null);
  }
  const updateNode = (values: Partial<CanvasInput["nodes"][number]>) =>
    change({
      ...data,
      nodes: data.nodes.map((n) =>
        n.id === selected ? { ...n, ...values } : n,
      ),
    });
  async function convert() {
    if (!node || !(await save())) return;
    if (serialize(current.current) !== lastSaved.current) {
      setError("The canvas changed while saving. Save it before converting.");
      return;
    }
    saving.current = true;
    try {
      const task = await api<Task>(`/canvases/${id}/nodes/${node.id}/task`, {
        method: "POST",
        headers: { "If-Match": String(version.current) },
        body: JSON.stringify({
          title: node.title,
          description: node.content,
          project_id: data.project_id,
        }),
      });
      const fresh = await api<Canvas>(`/canvases/${id}`);
      version.current = fresh.version;
      const next = {
        ...current.current,
        nodes: current.current.nodes.map((n) =>
          n.id === node.id
            ? { ...n, task_id: task.id, kind: "Task" as const }
            : n,
        ),
      };
      current.current = next;
      setData(next);
      lastSaved.current = serialize({
        name: fresh.name,
        project_id: fresh.project_id,
        viewport: fresh.viewport,
        nodes: fresh.nodes,
        edges: fresh.edges,
      });
      setUndo([]);
      setRedo([]);
      setTasks((t) => ({ ...t, [task.id]: task }));
      setStatus(serialize(next) === lastSaved.current ? "Saved" : "Unsaved");
      onTask(task);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setTick((n) => n + 1);
    }
  }
  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(current.current, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "axis-canvas-draft.json";
    a.click();
    URL.revokeObjectURL(url);
  }
  const statusTone =
    status === "Saved"
      ? "done"
      : status.startsWith("Save failed")
        ? "bad"
        : "review";
  return (
    <section className="canvas-workspace">
      <div className="panel canvas-bar">
        <button
          className="text-button"
          onClick={() => {
            if (!dirty || confirm("Leave without saving canvas changes?"))
              onBack();
          }}
        >
          ← Canvases
        </button>
        <label className="canvas-name">
          <span className="sr-only">Canvas name</span>
          <input
            value={data.name}
            maxLength={120}
            onChange={(e) => change({ ...data, name: e.target.value })}
          />
        </label>
        <span role="status" className={`approval-status tone-${statusTone}`}>
          {status}
        </span>
        <div className="canvas-bar-actions">
          <button
            className="icon-button canvas-tool"
            disabled={!undo.length}
            onClick={() => {
              const previous = undo.at(-1)!;
              setUndo((u) => u.slice(0, -1));
              setRedo((r) => [...r, data]);
              change(previous, false);
            }}
          >
            <Undo2 size={15} />
            Undo
          </button>
          <button
            className="icon-button canvas-tool"
            disabled={!redo.length}
            onClick={() => {
              const next = redo.at(-1)!;
              setRedo((r) => r.slice(0, -1));
              setUndo((u) => [...u, data]);
              change(next, false);
            }}
          >
            <Redo2 size={15} />
            Redo
          </button>
          <button
            className="secondary"
            disabled={saving.current}
            onClick={() => void save()}
          >
            <Save size={15} />
            Save now
          </button>
        </div>
      </div>
      {error && (
        <div className="error canvas-error" role="alert">
          <span>{error}</span>
          <span className="canvas-error-actions">
            <button className="text-button" onClick={exportDraft}>
              Download unsaved draft
            </button>
            <button
              className="text-button"
              onClick={() => {
                if (confirm("Discard local changes and load the saved canvas?"))
                  api<Canvas>(`/canvases/${id}`)
                    .then((c) => {
                      const next = {
                        name: c.name,
                        project_id: c.project_id,
                        viewport: c.viewport,
                        nodes: c.nodes,
                        edges: c.edges,
                      };
                      version.current = c.version;
                      lastSaved.current = serialize(next);
                      current.current = next;
                      setData(next);
                      setError("");
                      setStatus("Saved");
                      setUndo([]);
                      setRedo([]);
                    })
                    .catch((e) => setError(e.message));
              }}
            >
              Reload saved version
            </button>
          </span>
        </div>
      )}
      <div className="canvas-tools">
        <label className="canvas-add">
          <Plus size={15} aria-hidden="true" />
          <select
            aria-label="Node type"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value)
                add(e.target.value as (typeof canvasKinds)[number]);
              e.target.value = "";
            }}
            disabled={data.nodes.length >= 100}
          >
            <option value="">Add node…</option>
            {canvasKinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="search canvas-find">
          <Search size={15} />
          <input
            aria-label="Find node"
            placeholder="Find node…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <small>
          {data.nodes.length} nodes · {data.edges.length} links · Drag a handle
          to link nodes; select a node to edit it.
        </small>
      </div>
      <div className="canvas-layout">
        <div className="canvas-surface">
          <ReactFlow
            nodes={nodes}
            edges={data.edges.map((e) => ({
              ...e,
              selected: e.id === selectedEdge,
            }))}
            nodeTypes={nodeTypes}
            viewport={data.viewport}
            onViewportChange={(viewport) =>
              change({ ...current.current, viewport }, false)
            }
            minZoom={0.1}
            maxZoom={4}
            colorMode="dark"
            onNodeClick={(_e, n) => {
              setSelected(n.id);
              setSelectedEdge(null);
            }}
            onEdgeClick={(_e, e) => {
              setSelectedEdge(e.id);
              setSelected(null);
            }}
            onPaneClick={() => {
              setSelected(null);
              setSelectedEdge(null);
            }}
            onNodesChange={(changes) => {
              const edits = changes.filter(
                (c) =>
                  (c.type !== "select" && c.type !== "dimensions") ||
                  (c.type === "dimensions" && c.resizing),
              );
              if (!edits.length) return;
              const next = applyNodeChanges(edits, nodes);
              const ids = new Set(next.map((n) => n.id));
              change({
                ...current.current,
                nodes: next.map((n) => ({
                  ...current.current.nodes.find((old) => old.id === n.id)!,
                  x: n.position.x,
                  y: n.position.y,
                  width: n.width || 200,
                  height: n.height || 100,
                })),
                edges: current.current.edges.filter(
                  (e) => ids.has(e.source) && ids.has(e.target),
                ),
              });
            }}
            onEdgesChange={(changes) => {
              if (changes.some((c) => c.type === "remove"))
                change({
                  ...data,
                  edges: applyEdgeChanges(changes, data.edges),
                });
            }}
            onConnect={(c) => {
              if (c.source && c.target && data.edges.length < 200)
                change({
                  ...data,
                  edges: [
                    ...data.edges,
                    {
                      id: crypto.randomUUID(),
                      source: c.source,
                      target: c.target,
                      label: "Related",
                    },
                  ],
                });
            }}
          >
            <Background gap={22} size={1.2} color="#2c3342" />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor="#3a4560"
              maskColor="rgba(13, 15, 20, 0.7)"
            />
          </ReactFlow>
          {!data.nodes.length && (
            <div className="canvas-empty">
              <Workflow size={22} />
              <strong>An empty canvas</strong>
              <span>Use “Add node…” above to place your first idea.</span>
            </div>
          )}
        </div>
        <aside className="panel canvas-properties">
          {node ? (
            <>
              <header>
                <span className="eyebrow">{node.kind.toUpperCase()}</span>
                <h3>Node details</h3>
              </header>
              <label className="field">
                Title
                <input
                  maxLength={200}
                  value={node.title}
                  onChange={(e) => updateNode({ title: e.target.value })}
                />
              </label>
              <label className="field">
                Notes
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={node.content}
                  onChange={(e) => updateNode({ content: e.target.value })}
                />
              </label>
              <small className="help planning-help">
                Linked tasks use their current task title and status. These
                notes stay on the canvas.
              </small>
              <div className="canvas-node-actions">
                {node.task_id ? (
                  <>
                    <button
                      className="primary"
                      disabled={!tasks[node.task_id]}
                      onClick={() => onTask(tasks[node.task_id!]!)}
                    >
                      <ExternalLink size={14} />
                      Open task
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        updateNode({ task_id: null, kind: "Idea" })
                      }
                    >
                      <Unlink size={14} />
                      Detach task
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={!node.title.trim() || saving.current}
                    onClick={() => {
                      if (
                        confirm(
                          `Create a task named “${node.title}”? You can set its deadline in the task editor next.`,
                        )
                      )
                        void convert();
                    }}
                  >
                    <ListTodo size={14} />
                    Convert to task…
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => {
                    const copy = {
                      ...node,
                      id: crypto.randomUUID(),
                      x: node.x + 40,
                      y: node.y + 40,
                    };
                    change({ ...data, nodes: [...data.nodes, copy] });
                    setSelected(copy.id);
                  }}
                >
                  <Copy size={14} />
                  Duplicate node
                </button>
                <button
                  className="text-button approval-cancel"
                  onClick={() => {
                    change({
                      ...data,
                      nodes: data.nodes.filter((n) => n.id !== node.id),
                      edges: data.edges.filter(
                        (e) => e.source !== node.id && e.target !== node.id,
                      ),
                    });
                    setSelected(null);
                  }}
                >
                  <Trash2 size={13} />
                  Remove node (keeps task)
                </button>
              </div>
            </>
          ) : edge ? (
            <>
              <header>
                <span className="eyebrow">CONNECTION</span>
                <h3>Link details</h3>
              </header>
              <label className="field">
                Relationship
                <input
                  maxLength={100}
                  value={edge.label}
                  onChange={(e) =>
                    change({
                      ...data,
                      edges: data.edges.map((item) =>
                        item.id === edge.id
                          ? { ...item, label: e.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <div className="canvas-node-actions">
                <button
                  className="text-button approval-cancel"
                  onClick={() => {
                    change({
                      ...data,
                      edges: data.edges.filter((e) => e.id !== edge.id),
                    });
                    setSelectedEdge(null);
                  }}
                >
                  <Trash2 size={13} />
                  Remove connection
                </button>
              </div>
            </>
          ) : (
            <div className="canvas-hint">
              <MousePointerClick size={20} />
              <strong>Nothing selected</strong>
              <span>
                Select a node or connection to edit it. Lines are visual only
                and never change task dependencies.
              </span>
            </div>
          )}
        </aside>
      </div>
      <details className="approvals-info canvas-actions">
        <summary>
          <Settings2 size={15} /> Canvas actions
          <ChevronDown size={16} className="approvals-chevron" />
        </summary>
        <div className="canvas-actions-body">
          <button className="secondary" onClick={exportDraft}>
            <Download size={14} />
            Download draft
          </button>
          <button
            className="text-button approval-cancel"
            onClick={async () => {
              if (
                !confirm(
                  "Permanently delete this canvas? Linked tasks will remain.",
                )
              )
                return;
              try {
                await api(`/canvases/${id}`, {
                  method: "DELETE",
                  headers: { "If-Match": String(version.current) },
                });
                onBack();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Trash2 size={13} />
            Delete canvas
          </button>
        </div>
      </details>
    </section>
  );
}
