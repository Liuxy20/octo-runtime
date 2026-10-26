# MCode Adapter

[English](README.md) | [包导航](../README.zh.md)

把 MiniMax Code（`mcode acp`）接到 Runtime：复用通用 ACP Adapter。MiniMax 自己管模型，也不广告会话级选模选项，所以 Runtime 不发 `session/set_model`——以 runtime 上配置的模型为准。

## 什么时候用它

- 运行执行器的机器上已经装好 MiniMax Code 并登录。
- 你能接受选模由 MiniMax 决定，而不是由本次调用决定。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { mcodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-mcode";

const executor = new AgentExecutor();
executor.register(mcodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "mcode" } }]
  }
});
```

事件语义见 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。

## 绑定了什么

| 项           | 值                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------- |
| Adapter 类型 | `mcode`                                                                                        |
| 导出         | `mcodeAdapter`                                                                                 |
| 命令         | `mcode acp`                                                                                    |
| 输出         | 仅 canonical 事件                                                                              |
| 会话         | MiniMax 广告 `loadSession: false`；`session/load` 返回空即视为会话丢失，改用调用方给的恢复输入 |
| 模型         | 不发送；由 MiniMax 选择                                                                        |

## 限制

- canonical-only：必须传 `protocol_mode: "canonical"`。
- 没有 model setter，所以单次调用里的 `model` 落不下去；以 runtime 配置的模型为准。
- 只支持 `ask` 和 `full_access`；`assisted` 被拒绝。
- 探测只确认 `mcode` 存在，不证明已登录。

## 导入与分发

private workspace 包，没有公开的 MCode 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Provider 矩阵](../../.octospec/guides/providers.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
