import {
  agentEnvItem,
  invocationRuntimeLimits
} from "../../packages/octo-runtime-adapter-sdk/dist/index.js";
// 仅由 263 手动专项加载；回读跨真实 IPC 的预算，或等待所属调用取消。
import { appendFile } from "node:fs/promises";

export const adapter = {
  metadata: {
    type: "long-budget",

    protocolSupport: { protocol: "long-budget.canonical", modes: ["canonical"], nativeMethods: [] }
  },
  async *invoke(request, context) {
    context.configureRuntimeLimits?.(invocationRuntimeLimits(request));
    if (request.runMetadata?.startsFile)
      await appendFile(request.runMetadata.startsFile, "start\n");
    yield {
      protocolVersion: 2,
      type: "message.delta",
      payload: {
        text: JSON.stringify(agentEnvItem(request.agentEnv, "octo.execution", "limits"))
      }
    };
    if (request.prompt === "wait") {
      await new Promise((resolve) => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener("abort", resolve, { once: true });
      });
      return;
    }
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  }
};
