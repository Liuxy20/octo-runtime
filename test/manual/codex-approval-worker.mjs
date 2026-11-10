import { createFixtureCodexHost } from "../../test-support/codex-owner.mjs";
import { approvalFixture, until } from "./codex-approval-fixture.js";

export function createApprovalHost() {
  const host = createFixtureCodexHost({
    command: process.execPath,
    spawnFn: () => {
      const f = approvalFixture({ hold: true });
      void (async () => {
        await until(() => f.started);
        const text = JSON.stringify(f.writes.find((m) => m.method === "turn/start"));
        f.child.stderr.write("plugin catalog: 401 Unauthorized\n");
        // 先停在首条响应的写回调，避免批量填满队列抢先触发另一种失败。
        f.request("request-0");
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
          for (let i = 1; i < 256; i++) {
            f.request(`request-${i}`);
            await until(() => f.responses.length === i + 1);
          }
          await until(() => f.responses.length === 256);
          f.complete();
        }
      })().catch(() => f.close(1));
      return f.child;
    }
  });
  return { owner: host.owner, adapters: [host.adapter] };
}
