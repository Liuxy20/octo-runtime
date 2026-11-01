// 仅由配置快照手动专项加载，观察真实 worker 收到的配置与启动次数。
import { appendFile, access } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

export const adapter = {
  metadata: {
    type: "snapshot",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "snapshot.canonical", modes: ["canonical"], nativeMethods: [] }
  },
  async probe(options) {
    return {
      available: true,
      command: "snapshot-fixture",
      version: options?.providerOptions?.revision ?? "none"
    };
  },
  async *invoke(request, context) {
    if (request.runMetadata?.startsFile)
      await appendFile(request.runMetadata.startsFile, "start\n");
    const report = () => ({
      protocolVersion: 2,
      type: "message.delta",
      payload: {
        text: JSON.stringify({
          options: request.agentConfig?.providerOptions ?? {},
          limit: context.streamLimits.hostFrameMaxBytes
        })
      }
    });
    yield report();
    if (request.prompt === "large")
      yield {
        protocolVersion: 2,
        type: "message.delta",
        payload: { text: "x".repeat(5000) }
      };
    if (request.prompt === "wait") {
      const deadline = Date.now() + 10000;
      while (!request.signal.aborted) {
        if (Date.now() >= deadline) throw new Error("fixture gate timeout");
        try {
          await access(request.runMetadata.gateFile);
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await setTimeout(10);
      }
      if (request.signal.aborted) return;
      yield report();
    }
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  }
};

export const defaultAdapter = {
  ...adapter,
  metadata: { ...adapter.metadata, type: "codex" }
};
