# Using AgentRun (Optional)

[简体中文](../../zh-CN/guides/agent-runs.md) | [Documentation](../README.md)

After [SDK integration](../getting-started/sdk.md), business code can use the initialized `kernel.client`. This chapter covers execution without creating or closing services. Gateway already manages invocation for received messages; the host does not need to invoke again.

## 1. Invocation API

| Purpose | Signature | Notes |
| --- | --- | --- |
| Invoke | `client.invoke(input: InvokeInput, environment?: InvokeEnvironment): AsyncIterable` | Native by default; select canonical for common events |
| Cancel | `client.cancelInvocation(invocationId, reason?): Promise<{ accepted: boolean }>` | For this client's invocation; ACK is not terminal |
| Respond | `client.respondInteraction(invocationId, response): Promise<void>` | Canonical reply; native uses `respondNativeInteraction` |

## 2. Consume to Terminal

This example cancels interactions; a product can show them to the user and respond. Only `run.completed` indicates successful execution.

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

See [InvokeInput](../reference/invoke-input.md) and [output and control](../reference/output-and-control.md) for native events, interaction, cancellation, and observation. The integrating host still owns service shutdown.
