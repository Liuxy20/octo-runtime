# ACP Adapter

[English](README.md) | [包导航](../README.zh.md)

把任何说 ACP 的 CLI 变成 Runtime Adapter：一次调用跑一轮 prompt，原生 ACP update 映射成 `CanonicalEvent`，权限走桥接，进程清理归自己。本目录里有六个 Adapter 只是它的薄包装。

## 什么时候用它

- Provider CLI 已经支持 ACP，你只需要绑定命令、选模和审批流程。
- 你要 canonical 事件；ACP 原生的 `session/update` 名字不会漏到业务代码。
- Provider 是私有协议：改用 [Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md) 自己写。

## 发起一次调用

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createAcpAdapter } from "@mininglamp-oss/octo-runtime-adapter-acp";

const executor = new AgentExecutor();
executor.register(
  createAcpAdapter({ type: "hermes", provider: "hermes", command: "hermes", args: ["acp"] })
);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "hermes" } }
    ]
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

private workspace 包，不单独发布或通过完整包聚合导出。原生宿主从源码声明本包的 workspace 依赖并按需 import；独立应用使用 client 连接已装配的 Kernel。

## 延伸阅读

- [实现](src/index.ts)、[ACP 传输](../octo-runtime-acp-client/README.zh.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
- 可以照抄的包装：[Hermes](../octo-runtime-adapter-hermes/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。

## 私有 AgentEnv.Item

本包采用 `adapter.<metadata.type>/options`，可选 `modeId: string` 为 Provider 原生 ID；这是包内约定，不登记公共 protocol，也不将 adapter.xxx 规定为公共命名规范。

省略不探测或设置模式，也不主动重置续接会话。显式值必须为非空、非纯空白字符串，按原值精确匹配本次 Provider 广告；不 trim、不把 default 改为 build。优先使用 mode config option（含分组选项）及其真实 configId，否则使用 modes.availableModes。无广告、不支持值、缺 configId 或 RPC 拒绝均失败，不替换模式。当前值相同时不发 setter；否则调用 session/set_config_option 或 session/set_mode。setter 成功只表示请求被接受，不伪造生效回执。modeId 不改变审批授权。

将以下条目与调用方准备的 workspace、公共 adapter/model item 放在同一 agentEnv.items 中；modeId 使用本次原生广告中的值，示例值不承诺 Provider 支持。已有 options 合在同一 payload，旧 actmode 不转换。

```json
{ "namespace": "adapter.<metadata.type>", "name": "options", "payload": { "modeId": "plan" } }
```
