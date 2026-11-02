import assert from "node:assert/strict";
import { appendFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { kernelInput, frames } from "../kernel-fixture.js";
import { waitFor, withTimeout } from "../runtime-fixture.js";

/** 手动专项的本地握手：先原子发布所属 PID，再暂停 Gateway；不修改产品代码。 */
export function createRecoveryProbe(directory) {
  let state = { testPid: process.pid, children: [], workers: [] };
  let observer, before, unrelated, tail;
  const executeFresh = async () => {
    const { ref } = await observer.submit(
      kernelInput("independent client", { agentSessionId: "independent-fresh" })
    );
    assert.equal((await frames(observer, ref)).at(-1).control.state, "completed");
    assert.equal(ref.kernel_instance_id, before.kernel_instance_id);
  };
  const publish = () => {
    const path = join(directory, "state.json");
    writeFileSync(`${path}.tmp`, JSON.stringify(state));
    renameSync(`${path}.tmp`, path);
  };
  const event = (row) => {
    if (row.component === "channel-gateway" && row.stage === "SIGKILL" && row.event === "attempt") {
      process.kill(state.children.find((entry) => entry.component === "executor-kernel").pid, 0);
      row.kernelAlive = true;
    }
    appendFileSync(
      join(directory, "events.jsonl"),
      `${JSON.stringify({ ...row, at: Date.now(), monotonicAt: performance.now() })}\n`
    );
  };
  return {
    register({ home, children }) {
      state = {
        ...state,
        home,
        children: children.map(({ component, child }) => ({ component, pid: child.pid }))
      };
      publish();
    },
    async beforeShutdown({ children, endpoint }) {
      assert.equal(children.length, 2);
      for (const { child } of children) process.kill(child.pid, 0);
      observer = attachKernel({ endpoint });
      before = await observer.status();
      const { ref } = await observer.submit(
        kernelInput("interaction", { agentSessionId: "independent-inflight" })
      );
      unrelated = ref;
      let ready = false;
      tail = (async () => {
        const rows = [];
        for await (const row of observer.subscribe(ref)) {
          rows.push(row);
          if (row.event?.type === "interaction.requested") ready = true;
        }
        return rows;
      })();
      void tail.catch(() => {});
      await waitFor(() => ready);
      const action = process.env.OCTO_RECOVERY_GATEWAY_STOP ?? "pause";
      if (action === "pause") {
        assert.equal(children[1].child.kill("SIGSTOP"), true);
        await executeFresh();
        event({ event: "paused", kernelPid: before.pid, rpcSucceeded: true });
      } else if (action === "kill") {
        assert.equal(children[1].child.kill("SIGKILL"), true);
      }
    },
    async afterShutdown({ gatewayHost }) {
      try {
        assert.equal(gatewayHost.exitObserved, true);
        const after = await observer.status();
        assert.equal(after.pid, before.pid);
        assert.equal(after.kernel_instance_id, before.kernel_instance_id);
        await observer.respond(unrelated, { interactionId: "approval", outcome: "accepted" });
        assert.equal(
          (await withTimeout(tail, 5000, "UNRELATED_RUN_TIMEOUT")).at(-1).control.state,
          "completed"
        );
        await executeFresh();
        event({
          event: "kernel-independent",
          pid: after.pid,
          kernelInstanceId: after.kernel_instance_id,
          unrelatedCompleted: true,
          freshCompleted: true
        });
      } finally {
        observer?.close();
      }
    },
    event
  };
}
