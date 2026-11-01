import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";
import { approvalFixture, until } from "./codex-approval-fixture.js";

serveWorker([
  createCodexAdapter({
    command: "fixture",
    spawnFn: () => {
      const f = approvalFixture({ hold: true });
      void (async () => {
        await until(() => f.started);
        const text = JSON.stringify(f.writes.find((m) => m.method === "turn/start"));
        f.child.stderr.write("plugin catalog: 401 Unauthorized\n");
        for (let i = 0; i < 256; i++) f.request(`request-${i}`);
        await until(() => f.responses.length === 1);
        if (text.includes("transport-error")) {
          if (text.includes("cleanup-error")) {
            f.child.stdin.end = () => f.child.stdin;
            f.child.kill = () => {
              throw Object.assign(new Error("cleanup failed"), { code: "EIO" });
            };
          }
          f.child.stdin.emit("error", new Error("broken pipe"));
        } else {
          f.release();
          await until(() => f.responses.length === 256);
          f.complete();
        }
      })().catch(() => f.close(1));
      return f.child;
    }
  })
]);
