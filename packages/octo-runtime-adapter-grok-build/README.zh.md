# Grok Build Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 Grok Build 的 ACP stdio 协议跑一轮调用：拉起 `grok --no-auto-update agent --no-leader stdio`，完成 Grok 自己的认证协商，把输出、工具、会话、审批和提问映射成 `CanonicalEvent`。模型调用和工具归 Grok，Runtime 从不直接调 xAI API。

## 什么时候用它

- 机器上装好 Grok Build `>=1.0.67 <2.0.0`，宿主已完成原生认证。
- 你想把权限请求、ask-user 提问、计划审批交回自己的 UI。
- 你需要 Grok 的会话扩展，通用 ACP 工厂覆盖不到这些。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { grokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";

const executor = new AgentExecutor();
executor.register(grokBuildAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "grok-build" } }]
  }
});
```

## 绑定了什么

| 项            | 值                                                       |
| ------------- | -------------------------------------------------------- |
| Adapter 类型  | `grok-build`                                             |
| 导出          | `grokBuildAdapter`、`createGrokBuildAdapter`             |
| 命令          | `grok --no-auto-update agent --no-leader stdio`          |
| 输出          | 仅 canonical 事件                                        |
| 认证          | 广告出来的 `xai.api_key` 或 `cached_token`，按其顺序尝试 |
| 模型与 effort | 走广告的会话 setter；`xhigh` 可能降为 `high` 并给出告警  |

## 行为

- `ask` 和 `full_access` 设置原生 yolo 策略，关闭 autoMode。`assisted` 和显式 sandbox 覆盖会失败。
- full access 不会自动回答问题或批准计划——这些仍然回到同一次调用里。
- 显式加载会话会关闭 workspace 快照恢复。只有 `FS_NOT_FOUND` 才用调用方给的恢复输入。
- 取消会让待处理交互失效、发送 session cancel，并做有界进程清理。
- 图片需要 Provider 广告支持。MCP 走标准 session server，拒绝不支持的可选字段和未解析的模板语法。

## 限制

- 记录在案的测试版本是 1.0.67；兼容区间只是边界，不代表每个 release 和平台都验过。
- 不从环境变量推断认证状态，某个方法被拒后也不会换另一种再试。没有浏览器登录，不改凭据文件。
- 没有最终文本、队列回执、断连、进程退出、清理失败，都不报成功。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[worker 示例](examples/worker.mts)、[测试夹具](../../test/grok-build-adapter.test.js)。
- [真实验证记录](../../.octospec/tasks/95-grok-build-acp/reference.md)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)。
