# Qoder CLI CN Adapter

[English](README.md) | [包导航](../README.zh.md)

把中国版 Qoder CLI（`qoderclicn --acp`）接到 Runtime。行为和国际版一致——`full_access` 加 `--yolo`、走 `session/load` 续接——但它是独立的可执行文件，也注册成自己的 Adapter 类型，runtime 可以明确选择中国版。

## 什么时候用它

- 机器上装的是中国版，并且已经登录。
- runtime 需要区分两个 Qoder 发行版，而不是碰运气选到一个。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { qoderCliCnAdapter } from "@mininglamp-oss/octo-runtime-adapter-qoderclicn";

const executor = new AgentExecutor();
executor.register(qoderCliCnAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "qoderclicn" } }]
  }
});
```

事件语义见 [Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。

## 绑定了什么

| 项           | 值                                                               |
| ------------ | ---------------------------------------------------------------- |
| Adapter 类型 | `qoderclicn`                                                     |
| 导出         | `qoderCliCnAdapter`                                              |
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
