import { z } from "zod";

export const canvasKinds = [
  "Idea",
  "Note",
  "Goal",
  "Task",
  "Milestone",
  "Decision",
  "Risk",
  "Resource",
] as const;
export const canvasSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    project_id: z.uuid().nullable().default(null),
    viewport: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        zoom: z.number().min(0.1).max(4),
      })
      .strict(),
    nodes: z
      .array(
        z
          .object({
            id: z.uuid(),
            kind: z.enum(canvasKinds),
            title: z.string().trim().min(1).max(200),
            content: z.string().max(1000),
            x: z.number().finite(),
            y: z.number().finite(),
            width: z.number().min(100).max(1000),
            height: z.number().min(60).max(1000),
            task_id: z.uuid().nullable(),
          })
          .strict(),
      )
      .max(100),
    edges: z
      .array(
        z
          .object({
            id: z.uuid(),
            source: z.uuid(),
            target: z.uuid(),
            label: z.string().max(100),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((value, ctx) => {
    const ids = new Set(value.nodes.map((n) => n.id));
    if (
      ids.size !== value.nodes.length ||
      new Set(value.edges.map((e) => e.id)).size !== value.edges.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Node and edge IDs must be unique.",
      });
    if (value.edges.some((e) => !ids.has(e.source) || !ids.has(e.target)))
      ctx.addIssue({
        code: "custom",
        message: "Every edge needs two existing nodes.",
      });
  });
export type CanvasInput = z.infer<typeof canvasSchema>;
export type Canvas = CanvasInput & {
  id: string;
  version: number;
  updated_at: string;
};
