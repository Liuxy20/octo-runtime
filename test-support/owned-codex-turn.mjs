import { randomUUID } from "node:crypto";
import { CodexService } from "../packages/octo-runtime-adapter-codex/dist/service.js";
import { runCodexAppServerTurn } from "../packages/octo-runtime-adapter-codex/dist/app-server.js";

// This test host explicitly owns a service for one test; owner shutdown, not turn finally, reaps its tree.
export async function* runOwnedCodexTurn(options) {
  const service = new CodexService(randomUUID(), options.spec, options.spawnFn);
  const abort = () => {
    queueMicrotask(() => {
      void service.close().catch(() => {});
    });
  };
  options.request.signal?.addEventListener("abort", abort, { once: true });
  try {
    const channel = await service.acquire(options.request.signal);
    for await (const event of runCodexAppServerTurn({ ...options, channel })) {
      const terminal =
        (event.type?.startsWith("run.") &&
          ["run.completed", "run.failed", "run.cancelled"].includes(event.type)) ||
        (event.kind === "control" &&
          event.control.type === "state" &&
          event.control.state !== "running");
      if (terminal) await service.close();
      yield event;
    }
  } finally {
    options.request.signal?.removeEventListener("abort", abort);
    await service.close();
  }
}
