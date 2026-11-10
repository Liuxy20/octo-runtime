# Hermes Adapter

[English](README.md) | [包导航](../README.zh.md)

把 Hermes CLI（`hermes acp`）接到 Runtime：复用通用 ACP Adapter，一次调用跑一轮，Hermes 会话显式创建或续接，原生 update 归一化成 `CanonicalEvent`。Hermes 的安装和登录由宿主负责。

## 什么时候用它

- 运行执行器的机器上已经装好 Hermes 并登录。
- 你想让它和其他 Provider 走同一条 Core 或 Kernel 路径。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createHermesAdapter } from "@mininglamp-oss/octo-runtime-adapter-hermes";

const executor = new AgentExecutor();
executor.register(createHermesAdapter({ command: "/absolute/path/hermes", env: process.env }));

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
      { namespace: "octo.execution", name: "adapter", payload: { type: "hermes" } }
    ]
  }
});
```

事件按 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md) 消费；只有 `run.completed` 算成功终态。

## 绑定了什么

| 项           | 值                                                                        |
| ------------ | ------------------------------------------------------------------------- |
| Adapter 类型 | `hermes`                                                                  |
| 导出         | `createHermesAdapter`                                                           |
| 命令         | `hermes acp`                                                              |
| 输出         | 仅 canonical 事件                                                         |
| 会话         | 显式续接；`session/load` 返回空结果时视为会话丢失，改用调用方给的恢复输入 |
| 模型         | 用 Provider 广告的 ID；省略则保持 Provider 默认                           |

## 限制

- canonical-only：必须传 `protocol_mode: "canonical"`，Core 默认的 native 不会自动转换。
- 只支持 `ask` 和 `full_access`；`assisted` 在进程启动前就被拒绝。
- 探测只确认 `hermes` 存在，不证明已登录或有模型权限。
- 每次调用拥有自己的 ACP 进程；要 await 清理，不能拿取消回执当清理完成。

## 导入与分发

private workspace 包。发行版没有 Hermes 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Provider 矩阵](../../.octospec/guides/providers.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。

## 私有 AgentEnv.Item

本包采用 `adapter.hermes/options`，可选 `modeId: string` 为 Provider 原生 ID；这是包内约定，不登记公共 protocol，也不将 adapter.xxx 规定为公共命名规范。

省略不探测或设置模式，也不主动重置续接会话。显式值必须为非空、非纯空白字符串，按原值精确匹配本次 Provider 广告；不 trim、不把 default 改为 build。优先使用 mode config option（含分组选项）及其真实 configId，否则使用 modes.availableModes。无广告、不支持值、缺 configId 或 RPC 拒绝均失败，不替换模式。当前值相同时不发 setter；否则调用 session/set_config_option 或 session/set_mode。setter 成功只表示请求被接受，不伪造生效回执。modeId 不改变审批授权。

将以下条目与调用方准备的 workspace、公共 adapter/model item 放在同一 agentEnv.items 中；modeId 使用本次原生广告中的值，示例值不承诺 Provider 支持。已有 options 合在同一 payload，旧 actmode 不转换。

```json
{ "namespace": "adapter.hermes", "name": "options", "payload": { "modeId": "plan" } }
```
