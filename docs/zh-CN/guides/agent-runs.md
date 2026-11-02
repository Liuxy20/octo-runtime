# 使用 AgentRun（可选）

[English](../../en/guides/agent-runs.md) | [文档目录](../README.md)

完成 [SDK 接入](../getting-started/sdk.md)后，业务按需使用已初始化的 `kernel.client`。本章只处理执行，不创建或关闭服务。Gateway 接收消息时已管理这条调用链，宿主不需要再手动 invoke。

## 1. 调用接口

| 用途 | 签名 | 说明 |
| --- | --- | --- |
| 执行 | `client.invoke(input: InvokeInput, environment?: InvokeEnvironment): AsyncIterable` | 默认 native；指定 canonical 返回统一事件 |
| 取消 | `client.cancelInvocation(invocationId, reason?): Promise<{ accepted: boolean }>` | 取消本 client 的调用；ACK 不等于终态 |
| 交互 | `client.respondInteraction(invocationId, response): Promise<void>` | canonical 回复；native 用 `respondNativeInteraction` |

## 2. 消费到终态

示例遇到交互即取消，实际产品可展示给用户并回复；只有 `run.completed` 表示本次执行成功。

```ts
let terminal: string | undefined;
for await (const event of kernel.client.invoke({
  invocationId: "example-invocation",
  protocol_mode: "canonical",
  inputs: [{ type: "text", text: "请简要介绍这个项目。" }],
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
  }
})) {
  if (event.type === "message.delta") console.log(event.payload.text);
  // 示例遇到交互即取消；实际产品可展示给用户后回复。
  if (event.type === "interaction.requested")
    await kernel.client.cancelInvocation("example-invocation", "example interaction");
  if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
    terminal = event.type;
}
if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
```

输入字段见 [InvokeInput](../reference/invoke-input.md)，原生事件、交互、取消与观察语义见[输出与控制](../reference/output-and-control.md)。服务关闭仍由接入宿主负责。
