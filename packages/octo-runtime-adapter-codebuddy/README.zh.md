# CodeBuddy Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 CodeBuddy ACP 跑一轮：拉起 `codebuddy --acp`，创建或加载显式原生会话，发出本轮请求，把文本、公开思考、工具、用量和会话更新映射成 `CanonicalEvent`。它没有复用通用 ACP Adapter，是因为 CodeBuddy 的 permission-mode 参数和 ACP 映射都不一样。

## 什么时候用它

- 机器上装好 CodeBuddy 并登录，你想用它的 ACP 权限处理。
- 你需要把公开推理标成 `public_reasoning` 露出来。
- 你不需要这个 Adapter 支持图片输入或 MCP。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { codebuddyAdapter } from "@mininglamp-oss/octo-runtime-adapter-codebuddy";

const executor = new AgentExecutor();
executor.register(codebuddyAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codebuddy" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                              |
| ------------ | ----------------------------------------------- |
| Adapter 类型 | `codebuddy`                                     |
| 导出         | `codebuddyAdapter`、`createCodeBuddyAdapter`    |
| 命令         | `codebuddy --acp --permission-mode <mode>`      |
| 输出         | 仅 canonical 事件                               |
| 会话         | 新开会话，或按 id 加载显式会话                  |
| 模型         | 随 `session/new` 发送；加载既有会话不会重新选模 |

## 限制

- `assisted` 被拒绝，改由 Runtime 的权限桥应答。
- 图片输入直接拒绝，当前实现也不声明 MCP 支持。
- prompt 和控制文本走 ACP 的文本载体，不是独立的原生 system role。
- 以关联的 `session/prompt` 响应判定完成；update 安静下来不算。
- 探测只确认可执行文件存在，不证明账号或模型可用。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[ACP 传输](../octo-runtime-acp-client/README.zh.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
