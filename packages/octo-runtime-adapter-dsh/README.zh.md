# DeepSeek Harness Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 DeepSeek Harness 官方 Client SDK 和 stdio 服务跑一轮调用：启动或续接一个显式原生会话，送入本轮输入，把轨迹映射成 `CanonicalEvent`。这是唯一带公开入口的 Adapter：`@mininglamp-oss/octo-runtime/adapters/dsh`。它封装的是未经修改的上游 SDK，所以这项集成按实验性对待，不构成稳定性承诺。

## 什么时候用它

- 机器上装了 DeepSeek Harness 并已登录，Desktop 或 CLI 都行。
- Node.js 是 `^24` 或 `^26`——不是任意更高的主版本。
- 你接受下面列出的上游限制。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter);

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  approvalMode: "full_access",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                                                                  |
| ------------ | ----------------------------------------------------------------------------------- |
| Adapter 类型 | `dsh`                                                                               |
| 导出         | `dshAdapter`、`createDshAdapter`                                                    |
| 公开入口     | `@mininglamp-oss/octo-runtime/adapters/dsh`                                         |
| 可执行文件   | 优先 PATH 里的 `dsh`，否则用 macOS Desktop 内置版本；`dshBin`、`desktopPath` 可覆盖 |
| 输出         | 仅 canonical 事件                                                                   |
| 审批         | 只支持 `full_access`                                                                |
| 默认值       | profile `sdk`、provider `deepseek-account`、model `deepseek-flash`                  |

## 兼容性

Client 与 Provider 固定在 `0.2.1-rc.3`，wire 协议 `deepseek-harness-sdk-runtime/0.0.1`。记录在案的 macOS Desktop 版本是 commit `be72761ee1a6736ebcdf4f3739363b083ae53c98`；未知版本会校验失败。Desktop 启动依赖实验性的 `process.execve`，为的是保住官方 Client 的 PID 与 stdio 所有权。真实 Desktop 证据来自 Node 24；Windows 和 Linux 的原生发行版还没通过真实联调。

## 会话与限制

- 显式会话**先续接**，再更新工作目录、发送本轮输入。续接失败不会悄悄新开一个会话。
- 新会话的控制指令是独立的用户文本块，不是原生 system prompt。不重建任何应用历史。
- 上游在预解析输入、stderr、session map 上没有 Runtime 追加的内存边界；上游的 close 只确认直接子进程，不覆盖所有工具后代。Kernel worker 隔离去不掉这些限制。
- 用宿主自己的 API key 时要显式选 `deepseek-official`。环境变量缺失从来不作为原生登录状态的判断依据。
- SDK 的 `args` 是字符串数组，和 CLI 的字符串选项不一样。

## 验证

`node scripts/verify-dsh-live.mjs` 会调用配置好的真实 Provider 并写出验证文件；它是可选的，不在 CI 里跑。发行物打包的是官方 Client 与 Protocol 的 JavaScript，不含 Provider 安装和原生二进制，也没有下游 SDK 补丁。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [SDK 入门](../../docs/zh-CN/getting-started/sdk.md)、[上游限制](https://github.com/deepseek-ai/deepseek-harness/discussions/11031)。
