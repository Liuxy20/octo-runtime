# Qoder CLI CN Adapter

[English](README.md) | [包导航](../README.zh.md)

把中国版 Qoder CLI（`qoderclicn --acp`）接到 Runtime。行为和国际版一致——`full_access` 加 `--yolo`、走 `session/load` 续接——但它是独立的可执行文件，也注册成自己的 Adapter 类型，runtime 可以明确选择中国版。

## 什么时候用它

- 机器上装的是中国版，并且已经登录。
- runtime 需要区分两个 Qoder 发行版，而不是碰运气选到一个。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createQoderCliCnAdapter } from "@mininglamp-oss/octo-runtime-adapter-qoderclicn";

const executor = new AgentExecutor();
executor.register(createQoderCliCnAdapter({ command: "/absolute/path/qodercli", env: process.env }));

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
      { namespace: "octo.execution", name: "adapter", payload: { type: "qoderclicn" } }
    ]
  }
});
```

事件语义见 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。

## 绑定了什么

| 项           | 值                                                               |
| ------------ | ---------------------------------------------------------------- |
| Adapter 类型 | `qoderclicn`                                                     |
| 导出         | `createQoderCliCnAdapter`                                              |
| 命令         | `qoderclicn --acp`；`full_access` 时为 `qoderclicn --yolo --acp` |
| 输出         | 仅 canonical 事件                                                |
| 会话         | 走 `session/load` 续接                                           |
| 模型         | runtime 配了 Qoder CN 广告的模型时，走标准 ACP 选模              |

## 限制

- 只有 `full_access` 才加 `--yolo`。
- canonical-only：必须传 `protocol_mode: "canonical"`。
- 只支持 `ask` 和 `full_access`；`assisted` 被拒绝。
- 探测只确认 `qoderclicn` 存在，不证明已登录。

## 导入与分发

private workspace 包。国际版是另一个 Adapter：[Qoder CLI](../octo-runtime-adapter-qodercli/README.zh.md)。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Provider 矩阵](../../.octospec/guides/providers.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。

## 私有 AgentEnv.Item

本包采用 `adapter.qoderclicn/options`，可选 `modeId: string` 为 Provider 原生 ID；这是包内约定，不登记公共 protocol，也不将 adapter.xxx 规定为公共命名规范。

省略不探测或设置模式，也不主动重置续接会话。显式值必须为非空、非纯空白字符串，按原值精确匹配本次 Provider 广告；不 trim、不把 default 改为 build。优先使用 mode config option（含分组选项）及其真实 configId，否则使用 modes.availableModes。无广告、不支持值、缺 configId 或 RPC 拒绝均失败，不替换模式。当前值相同时不发 setter；否则调用 session/set_config_option 或 session/set_mode。setter 成功只表示请求被接受，不伪造生效回执。modeId 不改变审批授权。

将以下条目与调用方准备的 workspace、公共 adapter/model item 放在同一 agentEnv.items 中；modeId 使用本次原生广告中的值，示例值不承诺 Provider 支持。已有 options 合在同一 payload，旧 actmode 不转换。

```json
{ "namespace": "adapter.qoderclicn", "name": "options", "payload": { "modeId": "plan" } }
```
