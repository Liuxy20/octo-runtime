# OpenCode Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 OpenCode v2 CLI 跑一轮，传输方式随审批模式切换：`full_access` 用 JSON 输出，`ask` 走 ACP。两条路最后都落到 `CanonicalEvent`。版本检查、配置映射和完成判定都留在这里，不漏进 Core。

## 什么时候用它

- 机器上装好 OpenCode 2.1.3 或更新版本（低于 3.0），并且已认证。
- 你希望 `ask` 走 ACP，无人值守时走更简单的 CLI JSON。
- 你不需要图片输入；`assisted` 也不支持。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { opencodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-opencode";

const executor = new AgentExecutor();
executor.register(opencodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "opencode" } }]
  }
});
```

## 绑定了什么

| 项            | 值                                                                                      |
| ------------- | --------------------------------------------------------------------------------------- |
| Adapter 类型  | `opencode`                                                                              |
| 导出          | `opencodeAdapter`、`createOpenCodeAdapter`                                              |
| `full_access` | `opencode run --format json --thinking --auto --standalone`                             |
| `ask`         | `opencode acp`，复用通用 ACP Adapter                                                    |
| 输出          | 仅 canonical 事件                                                                       |
| 模型          | `provider/model`；带 effort 时变成 `provider/model#variant`，其中 `xhigh` 映射为 `high` |
| MCP           | CLI 模式用原生 v2 的 `mcp.servers`，ACP 模式用协商出来的会话 server                     |

## 限制

- 支持的版本是探测到的 `>=2.1.3 <3`。读不出或不在范围内直接失败；这个区间只代表兼容范围，不代表每个 release 都验过。
- `assisted` 和图片输入都会被拒绝。
- 检查的是本次调用 cwd 与环境里真正被选中的可执行文件。
- 配置通过 `OPENCODE_CONFIG_CONTENT` 合并，不改用户文件，`cwd` 与 `PWD` 保持一致。
- CLI 路径的成功要求正常退出**且**有最终文本。工具或 step 停下来不算 Run 成功。
- 原生权限拒绝依然生效。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
