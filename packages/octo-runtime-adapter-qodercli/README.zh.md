# Qoder CLI Adapter

[English](README.md) | [包导航](../README.zh.md)

把国际版 Qoder CLI（`qodercli --acp`）接到 Runtime：复用通用 ACP Adapter。`full_access` 时追加 Qoder 的 `--yolo`，选中 ACP 的 "bypass permissions" 模式，让无人值守的工具执行不卡在交互审批上。

## 什么时候用它

- 机器上装的是国际版 Qoder，并且已经登录。
- 你希望走 `session/load` 续接会话，而不是降级到新会话。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createQoderCliAdapter } from "@mininglamp-oss/octo-runtime-adapter-qodercli";

const executor = new AgentExecutor();
executor.register(createQoderCliAdapter({ command: "/absolute/path/qodercli", env: process.env }));

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.execution", name: "adapter", payload: { type: "qodercli" } }
    ]
  }
});
```

事件语义见 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。

## 绑定了什么

| 项           | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| Adapter 类型 | `qodercli`                                                   |
| 导出         | `createQoderCliAdapter`                                            |
| 命令         | `qodercli --acp`；`full_access` 时为 `qodercli --yolo --acp` |
| 输出         | 仅 canonical 事件                                            |
| 会话         | 走 `session/load` 续接，不需要新会话兜底                     |
| 模型         | runtime 配了 Qoder 广告的模型时，走标准 ACP 选模             |

## 限制

- 只有 `full_access` 才加 `--yolo`，不会顺带提升其他模式。
- canonical-only：必须传 `protocol_mode: "canonical"`。
- 只支持 `ask` 和 `full_access`；`assisted` 被拒绝。
- 探测只确认 `qodercli` 存在，不证明已登录。

## 导入与分发

private workspace 包。中国版用 [Qoder CLI CN](../octo-runtime-adapter-qoderclicn/README.zh.md)，那是另一个可执行文件和 Adapter 类型。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Provider 矩阵](../../.octospec/guides/providers.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。

## 私有 AgentEnv.Item

本包采用 `adapter.qodercli/options`，可选 `modeId: string` 为 Provider 原生 ID；这是包内约定，不登记公共 protocol，也不将 adapter.xxx 规定为公共命名规范。

省略不探测或设置模式，也不主动重置续接会话。显式值必须为非空、非纯空白字符串，按原值精确匹配本次 Provider 广告；不 trim、不把 default 改为 build。优先使用 mode config option（含分组选项）及其真实 configId，否则使用 modes.availableModes。无广告、不支持值、缺 configId 或 RPC 拒绝均失败，不替换模式。当前值相同时不发 setter；否则调用 session/set_config_option 或 session/set_mode。setter 成功只表示请求被接受，不伪造生效回执。modeId 不改变审批授权。

将以下条目与调用方准备的 workspace、公共 adapter/model item 放在同一 agentEnv.items 中；modeId 使用本次原生广告中的值，示例值不承诺 Provider 支持。已有 options 合在同一 payload，旧 actmode 不转换。

```json
{ "namespace": "adapter.qodercli", "name": "options", "payload": { "modeId": "plan" } }
```
