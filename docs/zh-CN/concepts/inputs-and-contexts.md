# Inputs 与 agentEnv

[English](../../en/concepts/inputs-and-contexts.md) | [文档目录](../README.md)

`KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)` 使用四个平铺参数。`inputs` 是业务方已经准备好的本轮文本/图片；`agentEnv` 是可复用的执行信封配置，每次调用复制冻结。工作目录、Adapter、模型/思考强度、环境变量、MCP、审批、执行预算和受信指令归 agentEnv。

Runtime 不拼装历史、不解释 `extra.im`、不自动渲染业务 Context。Gateway/应用自己选择历史、规则、资料和图片，并组成 inputs。纯文本、Markdown、`<namespace ...>` 等均可；命名空间标签只是应用的可选格式，与执行协议无关。

```ts
const agentEnv = {
  schema: "octo.context-envelope/v3" as const,
  items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
    { namespace: "octo.execution", name: "workspace", payload: { mode: "fixed", path: process.cwd() } },
    { namespace: "octo.execution", name: "model", payload: { reasoning: { effort: "high" } } }
  ]
};
const run = client.invoke(
  [{ type: "text", text: "Summarize this application-prepared history: ..." }],
  "conversation-42",
  undefined,
  agentEnv
);
// A Stop button can call: await client.interrupt(run.invocationId);
for await (const frame of run) {
  // Consume the original stream through its terminal event.
}
```

信封仍是 `schema: "octo.context-envelope/v3"` 与 `items`（namespace/name/payload）；Run 事件版本不变。执行设置不会自动拼入模型正文，受信 `octo.control/instructions` 仍进入 Provider 的独立指令通道。工具本身可以读取执行环境，因此凭据不能出现在业务 inputs 或日志里。

普通 inputs 是 `ModelInputPart[]`。需要 canonical 输出或冻结恢复材料时，可使用 `InvocationContent`：`{ parts, protocol_mode: "canonical", freshFallbackModelInputParts, ... }`，只携带内容、追踪身份和代次，不包含环境或会话参数。它不是旧的外层 invoke 请求对象。

详见 [字段参考](../reference/invoke-input.md)、[标识与所有权](identifiers.md)、[会话](../guides/context-and-sessions.md)。
