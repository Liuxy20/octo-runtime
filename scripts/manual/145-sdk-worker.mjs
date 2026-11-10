// 仅手动合同验证使用：无 Provider、网络账号或安装发现，等待项由本轮取消释放。
export const adapters = [
  {
    metadata: {
      type: "docs",

      protocolSupport: { protocol: "docs.native", modes: ["native"], nativeMethods: [] }
    },
    async *invoke(request) {
      yield { kind: "native", messageKind: "notification", payload: { text: request.modelInput } };
      if (request.modelInput === "hold") {
        await new Promise((resolve) => {
          if (request.signal.aborted) resolve();
          else request.signal.addEventListener("abort", resolve, { once: true });
        });
        return;
      }
      yield { kind: "control", control: { type: "state", state: "completed" } };
    }
  }
];
