import { setTimeout as delay } from "node:timers/promises";

// 真实 IM/Kernel 验收使用可控静默执行端；不调用模型、不记录 Context 或凭据。
export const modelWaitAdapter = {
  metadata: {
    type: "model-wait-fixture",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "model-wait-fixture", modes: ["canonical"], nativeMethods: [] }
  },
  async *invoke(request) {
    // Context may contain earlier QA messages; the current input is appended last.
    const mode = [...request.prompt.matchAll(/MODEL_WAIT_QA:(silent|recover|stop)/g)].at(-1)?.[1];
    if (!mode) throw new Error("QA_MARKER_REQUIRED");
    if (mode !== "recover") {
      if (!request.signal.aborted)
        await new Promise((resolve) =>
          request.signal.addEventListener("abort", resolve, { once: true })
        );
      return;
    }
    await delay(35_000, undefined, { signal: request.signal });
    yield {
      protocolVersion: 2,
      type: "message.delta",
      payload: { messageId: "progress", channel: "commentary", text: "MODEL_WAIT_QA_OUTPUT" }
    };
    yield {
      protocolVersion: 2,
      type: "tool_call.create",
      payload: { id: "quiet-tool", name: "qa_wait", args: {}, status: "running" }
    };
    await delay(35_000, undefined, { signal: request.signal });
    yield {
      protocolVersion: 2,
      type: "tool_call.update",
      payload: { id: "quiet-tool", status: "completed" }
    };
    yield {
      protocolVersion: 2,
      type: "message.delta",
      payload: { messageId: "answer", channel: "final", text: "MODEL_WAIT_QA_OK" }
    };
    yield { protocolVersion: 2, type: "run.completed", payload: {} };
  }
};
