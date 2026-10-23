import { lazy, Suspense, type ComponentProps } from "react";
const LazyCanvas = lazy(() =>
  import("./Canvas").then((module) => ({ default: module.CanvasPage })),
);
export function CanvasPage(props: ComponentProps<typeof LazyCanvas>) {
  return (
    <Suspense fallback={<p role="status">Loading canvas…</p>}>
      <LazyCanvas {...props} />
    </Suspense>
  );
}
