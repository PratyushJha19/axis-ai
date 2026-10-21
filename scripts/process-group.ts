import { spawn, type ChildProcess } from "node:child_process";

// Separate Node children preserve worker isolation from the API/model. A failed
// child stops the group so the host can restart it instead of hiding dead delivery.
export async function runProcessGroup(
  commands: string[][],
  signal?: AbortSignal,
  graceMs = 10000,
): Promise<number> {
  if (signal?.aborted) return 0;
  if (!commands.length) throw new Error("No services configured.");
  return new Promise((resolve) => {
    const children = new Set<ChildProcess>();
    let stopping = false,
      result = 0;
    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (!stopping || children.size) return;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const stop = (code: number) => {
      if (stopping) return;
      stopping = true;
      result = code;
      for (const child of children) child.kill("SIGTERM");
      timer = setTimeout(() => {
        for (const child of children) child.kill("SIGKILL");
      }, graceMs);
      finish();
    };
    const abort = () => stop(0);
    signal?.addEventListener("abort", abort, { once: true });
    for (const args of commands) {
      const child = spawn(process.execPath, args, {
        stdio: "inherit",
        shell: false,
      });
      children.add(child);
      child.once("error", () => stop(1));
      child.once("close", () => {
        children.delete(child);
        if (!stopping) stop(1);
        finish();
      });
    }
    if (signal?.aborted) abort();
  });
}
