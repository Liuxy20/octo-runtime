# Claude Code Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 Claude Code 的双向 stream-json CLI 跑一轮调用。每次调用拥有一个 `claude` NDJSON 子进程，把准备好的工作目录、模型、effort、MCP 配置、权限和显式会话映射成参数，返回 canonical 事件或 native driver frame。Core 里不需要任何 Claude 分支。

## 什么时候用它

- 宿主机上装好 Claude Code 并登录。
- 你想通过 `can_use_tool` 做交互式工具审批，而不是靠 bypass flag。
- 你既要 canonical 事件也要 native Provider 帧；这是少数同时支持两种模式的 Adapter。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { createClaudeCodeAdapter } from "@mininglamp-oss/octo-runtime-adapter-claude-code";

const executor = new AgentExecutor();
executor.register(createClaudeCodeAdapter({ command: "/absolute/path/claude", env: process.env }));

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
      { namespace: "octo.execution", name: "adapter", payload: { type: "claude-code" } }
    ]
  }
});
```

## 绑定了什么

| 项           | 值                                                 |
| ------------ | -------------------------------------------------- |
| Adapter 类型 | `claude-code`                                      |
| 导出         | `createClaudeCodeAdapter`     |
| 协议         | `claude.stream-json`，模式 `native` 与 `canonical` |
| 传输         | 每次调用一个 `claude` NDJSON stdio 子进程          |
| 会话         | 显式 Provider 会话；没给才新开                     |
| 交互         | 双向 `can_use_tool` 请求，走当前调用的交互桥       |

## 配置与会话归属

上例采用 `ask` 审批模式，推理强度沿用 Provider 默认。审批通过 Context `octo.security/approval_policy` 设置，强度通过 `octo.execution/model.payload.reasoning.effort` 设置。Adapter 接收准备后的内部 `InvokeRequest`；当前字段与被拒绝的旧配置见[输入参考](../../docs/zh-CN/reference/invoke-input.md)。

调用方保存会话更新中的完整 `providerSession`（含 Provider 扩展字段），并在下一轮显式回传。只复用业务 `sessionId` 会新开 Provider 会话；Core 不持久维护业务会话到 Provider 的绑定表。续接与恢复输入步骤见[背景资料与会话](../../docs/zh-CN/guides/context-and-sessions.md)。

## 限制

- 审批回复有两条路径：native 消费方回 native 请求，canonical 消费方回 Runtime 交互。别混用。
- 不支持的审批模式直接失败，不会降级成 full access。
- 工作目录和权限设置是 Provider 侧的配置，不是操作系统隔离。
- 流式文本、公开推理、工具事件是分开的；消息结束不等于 Run 结束。
- 取消和所有退出路径都 await 自有进程清理；平台限制见下文。

## 自有进程清理

Claude Code 使用 SDK `spawnJsonLines`。POSIX 下创建独立进程组，并 await 有界的 `SIGTERM` → `SIGKILL` 升级及进程组退出确认。leader 退出不代表已释放该组中仍在运行的工具进程。

Windows 上此路径未启用共享清理工具的 `processTree` 选项；目标与确认范围为直接子进程，不保证全部后代退出。Kernel 的额外清理由其自身所有权路径负责。宿主崩溃和逃离自有组的进程不在正常清理保证内。

执行终态与取消见[输出与交互控制](../../docs/zh-CN/reference/output-and-control.md)，`shutdown()` 清理结果见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。Provider result 或取消回执本身不证明清理成功。

## 导入与分发

private workspace 包，包含在 CLI 发行物里。没有单独的 npm 包，也没有公开 SDK 子路径。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [输入参考](../../docs/zh-CN/reference/invoke-input.md)。
