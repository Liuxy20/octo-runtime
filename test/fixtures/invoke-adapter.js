import { appendFile } from "node:fs/promises";
const pending = new Map();
export const testAdapter = {
  metadata: {
    type: "test",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "test.invoke", modes: ["native", "canonical"], nativeMethods: [] }
  },
  async *invoke(request, context) {
    if (request.runMetadata?.startsFile)
      await appendFile(request.runMetadata.startsFile, "start\n");
    const native = context.protocolMode === "native";
    if (request.prompt === "overflow") {
      for (let n = 0; n < 5000; n++)
        yield { kind: "native", messageKind: "notification", payload: { n } };
    }
    if (request.prompt === "interaction") {
      let release;
      const response = new Promise((resolve) => {
        release = resolve;
      });
      pending.set(request.invocationId, release);
      try {
        if (native)
          yield { kind: "native", messageKind: "request", payload: { id: 42, method: "approval" } };
        else
          yield {
            protocolVersion: 2,
            type: "interaction.requested",
            payload: {
              interactionId: "approval",
              kind: "question",
              executionInstanceId: request.invocationId,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              request: { title: "Approve?" }
            }
          };
        await response;
      } finally {
        pending.delete(request.invocationId);
      }
    }
    if (request.prompt === "wait-for-cancel") {
      await new Promise((resolve) => {
        if (request.signal.aborted) resolve();
        else request.signal.addEventListener("abort", resolve, { once: true });
      });
      return;
    }
    if (native) {
      yield {
        kind: "native",
        messageKind: "notification",
        payload: {
          exact: { future: [1, "retained"] },
          inputs: request.modelInputParts,
          contexts: request.context,
          ...(request.executionEnvOverrides ? { environment: request.executionEnvOverrides } : {})
        }
      };
      yield { kind: "control", control: { type: "state", state: "completed" } };
    } else {
      yield {
        protocolVersion: 2,
        type: "message.delta",
        payload: { channel: "final", text: "answer" }
      };
      yield { protocolVersion: 2, type: "run.completed", payload: {} };
    }
  },
  async respondInteraction(id, response) {
    if (response.interactionId !== "approval" || !pending.has(id))
      throw new Error("INTERACTION_NOT_PENDING");
    pending.get(id)();
    pending.delete(id);
  },
  async respondNative(id, response) {
    if (response.requestId !== 42 || !pending.has(id)) throw new Error("INTERACTION_NOT_PENDING");
    pending.get(id)();
    pending.delete(id);
  }
};
