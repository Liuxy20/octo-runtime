// 无 responseRequired 的旧 Adapter 仍要求外部回答；不通过宿主策略猜测。
export const adapter = {
  metadata: {
    type: "ort166-legacy",
    agentSources: ["provisioned"],
    protocolSupport: { protocol: "ort166.canonical", modes: ["canonical"], nativeMethods: [] }
  },
  async respondInteraction() {},
  async *invoke(request) {
    yield {
      protocolVersion: 2,
      type: "interaction.requested",
      payload: {
        interactionId: "legacy-question",
        executionInstanceId: request.invocationId,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        kind: "question",
        request: {}
      }
    };
    await new Promise((resolve) => {
      if (request.signal.aborted) resolve();
      else request.signal.addEventListener("abort", resolve, { once: true });
    });
  }
};
