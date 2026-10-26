# ACP Adapter

[English](README.md) | [包导航](../README.zh.md)

把任何说 ACP 的 CLI 变成 Runtime Adapter：一次调用跑一轮 prompt，原生 ACP update 映射成 `CanonicalEvent`，权限走桥接，进程清理归自己。本目录里有六个 Adapter 只是它的薄包装。

## 什么时候用它

- Provider CLI 已经支持 ACP，你只需要绑定命令、选模和审批流程。
- 你要 canonical 事件；ACP 原生的 `session/update` 名字不会漏到业务代码。
- Provider 是私有协议：改用 [Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md) 自己写。

## 发起一次调用

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

const executor = new AgentExecutor();
executor.register(
  createAcpAdapter({ type: "hermes", provider: "hermes", command: "hermes", args: ["acp"] })
);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "hermes" } }]
  }
});

try {
  let terminal: string | undefined;
  for await (const event of executor.invoke({ ...input, protocol_mode: "canonical" })) {
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      terminal = event.type;
    if (event.type === "run.failed") throw new Error(JSON.stringify(event.payload));
  }
  if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
} finally {
  const { cleanup } = await executor.shutdown();
  if (cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

## 定义字段

| 字段                          | 含义                                                            |
| ----------------------------- | --------------------------------------------------------------- |
| `type`                        | Adapter 类型，`octo.execution` / `adapter` Context 项里用它选人 |
| `provider`                    | 写进归一化事件的 Provider 名                                    |
| `command`                     | 要拉起的可执行文件                                              |
| `args`                        | 固定参数，或 `(request) => string[]` 从已准备的请求生成         |
| `env`                         | 可选，`(request) => ProcessEnv`                                 |
| `protocolVersion`             | 请求的 ACP 协议版本                                             |
| `emptyLoadResultMeansMissing` | 把空的 `session/load` 结果当作会话丢失，改用调用方给的恢复输入  |

可选的第二个参数用来替换传输：`{ acpClientFactory, command }`。

## 行为

- 审批模式只支持 `ask` 和 `full_access`。`assisted` 在任何东西启动前就抛 `APPROVAL_MODE_UNSUPPORTED`。
- 选模优先用 Provider 广告的 `configOptions`，否则退回旧模型列表。显式指定模型却没有可用 setter 时直接失败，不猜。
- 图片和 MCP 要求 Provider 广告了相应能力；没有能力却要 MCP 会抛 `MCP_UNSUPPORTED`。
- canonical-only：必须传 `protocol_mode: "canonical"`。Core 默认的 native 不会自动转换。
- 每次调用拥有自己的 ACP 进程。取消回执或停止迭代都不证明清理完成，要 await。

## 导入与分发

private workspace 包。发行版只暴露 `/adapters/dsh`，目前没有公开的 ACP 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP 传输](../octo-runtime-acp-client/README.zh.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
- 可以照抄的包装：[Hermes](../octo-runtime-adapter-hermes/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
