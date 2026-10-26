# Kimi Code Adapter

[English](README.md) | [包导航](../README.zh.md)

把 Kimi Code（`kimi acp`）接到 Runtime：复用通用 ACP Adapter，一次调用对一个新的或显式续接的会话跑一轮，原生 update 变成 `CanonicalEvent`。Provider 安装、登录和 Context 都归宿主。

## 什么时候用它

- 运行执行器的机器上已经装好 Kimi Code 并登录。
- 你想按 Kimi 广告的 `configOptions` 做会话级选模。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { kimiCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-kimi-code";

const executor = new AgentExecutor();
executor.register(kimiCodeAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "kimi-code" } }]
  }
});
```

事件语义见 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。

## 绑定了什么

| 项           | 值                                                                                     |
| ------------ | -------------------------------------------------------------------------------------- |
| Adapter 类型 | `kimi-code`                                                                            |
| 导出         | `kimiCodeAdapter`                                                                      |
| 命令         | `kimi acp`                                                                             |
| 输出         | 仅 canonical 事件                                                                      |
| 会话         | 新会话，或由 ACP Adapter 显式续接的 Provider 会话                                      |
| 模型         | Provider 广告的 `configOptions` 里的 model 分类，通过 `session/set_config_option` 应用 |

## 限制

- canonical-only：必须传 `protocol_mode: "canonical"`。
- 用广告出来的选项值，不要用展示名。Provider 设不了的显式模型直接失败，不猜。
- 省略模型则保持 Provider 默认。
- 只支持 `ask` 和 `full_access`；`assisted` 被拒绝。
- 探测只确认 `kimi` 存在，不证明已登录。

## 导入与分发

private workspace 包，没有公开的 Kimi 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP Adapter](../octo-runtime-adapter-acp/README.zh.md)、[Provider 矩阵](../../.octospec/guides/providers.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
