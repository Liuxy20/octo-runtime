# Executor Core

[English](README.md) | [包导航](../README.zh.md)

`AgentExecutor` 是 Octo Runtime 里真正执行 Agent 的唯一位置。注册你随包发布的 Adapter，交给它一个 `InvokeInput`，它负责准备本轮输入、调用选中的 Provider，并把结果流式返回。Kernel 在自己的独立 worker 里跑的就是这个类，所以进程内直接嵌入和走 Kernel 不会长成两套执行行为。

## 什么时候用它

- 你要在自己的进程里执行，并且接受共用事件循环、内存和故障域。
- 你在写 Kernel 的 worker 入口——`serveWorker` 会替你构造 `AgentExecutor`。
- 你需要进程隔离、监督或流回放：改用 [Kernel](../octo-runtime-executor-kernel/README.zh.md)。

## 发起一次调用

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter); // metadata.type is "dsh"; a duplicate type throws

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  approvalMode: "full_access",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
  }
});

try {
  let terminal: string | undefined;
  for await (const event of executor.invoke({ ...input, protocol_mode: "canonical" })) {
    if (event.type === "message.delta" && event.payload.channel === "final")
      process.stdout.write(event.payload.text ?? "");
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      terminal = event.type;
    if (event.type === "run.failed") throw new Error(JSON.stringify(event.payload));
  }
  if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
} finally {
  const { cleanup } = await executor.shutdown();
  if (cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

两个容易踩的点：Adapter 由 `octo.execution` / `adapter` 这个 Context 项决定，不是构造参数；显式要 `canonical` 才会拿到 `CanonicalEvent`，默认是 Provider 原始帧。

## 它对你的输入做了什么

校验并冻结请求，渲染本轮的模型输入，解析本地执行环境，然后接纳这次 Run。接纳发生在 Provider 启动之前：身份、容量、关闭状态都在这一步检查。业务 Context 只来自本次调用，Core 不会从会话历史里补。

`invokeFrames` 同步校验，请求不合法时在调用点就抛；`invoke` 是异步生成器，它的检查都落在第一次 `next()`。所以要把整个消费循环包进 try，而不是只包一次调用——没有被消费的迭代器不占容量，也不会拉起 Provider。

`environment` 是第二个参数，永远不进 JSON：

- `signal`——本次 Run 的取消信号。
- `executionEnvOverrides`——宿主注入的可信值。
- `streamLimits`——本地流预算；Kernel 会拒绝它（`KERNEL_STREAM_LIMITS_UNSUPPORTED`）。

## API

| 调用                                  | 作用                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `register(adapter)`                   | 按 `metadata.type` 注册。同类型第二次注册抛错。                                                    |
| `list()`、`describe(configurations?)` | 列出已注册 Adapter；`describe` 还会探测安装情况并给出 `available` 和原因。可用不等于这次一定成功。 |
| `invoke(input, environment?)`         | 常规入口。默认 `native` 帧，`protocol_mode: "canonical"` 时给 `CanonicalEvent`。                   |
| `invokeFrames(input, environment?)`   | 同一次执行，但保留每个事件外层的 `HostFrame` 信封（run ID、invocation ID、`seq`）。                |
| `cancel(invocationId)`                | 请求取消。返回 `true` 只代表请求被接受，不代表 Provider 已退出。                                   |
| `respondInteraction`、`respondNative` | 向发起该交互的调用回复。                                                                           |
| `shutdown(reason?, timeoutMs = 2500)` | 停止接纳，并在有界时间内等待清理。                                                                 |

## 一次 Run 怎么算结束

canonical 模式下只有 `run.completed` 算成功。最终消息发出不算，取消被接受不算，迭代器自然结束也不算。

提前关闭本地迭代器会**请求取消**——这一点和 Kernel 相反，那里停止观察不会动正在跑的执行。没人关闭也没人取消的迭代器不会自己取消：它继续跑并占着容量，直到执行结束或所有者 shutdown。

## 清理

`shutdown()` 返回一份不可变快照。`state: "closed"` 只说明不再接纳新 Run；只有 `cleanup: "complete"` 才代表它拥有的资源都真的释放了。结果是 `incomplete` 时，`unresolvedInvocationIds` 和 `failedCleanupInvocationIds` 会指出还挂着谁。

接纳一旦关闭就不再打开，失败的 finalizer 也不会重试——再调一次 `shutdown()` 只会重新等待，不会复活上一次尝试。`next()` 被拒、`return()` 返回 `done: false`、或者生成器没有可用的 finalizer，都不等于资源已释放。

Provider 终态排空和迭代器关闭共用一个单调的 `cancelGraceMs` 预算，从第一次终态、abort 或清理请求开始计时；`shutdown` 的超时只约束调用方这次等待。

Core 最多保留 1,024 条调用身份记录，并在 120 秒后回收非活动记录。活动、暂停、未清理完的调用不会被回收，所以泄漏的所有权最终会耗尽容量。这些记录是关联状态，不是历史，也不是输出回放缓冲。

## 直接 Core 还是 Kernel

| 关注点                     | 直接 `AgentExecutor`                                        | `KernelClient`                    |
| -------------------------- | ----------------------------------------------------------- | --------------------------------- |
| 执行位置                   | 你的进程                                                    | Kernel 的独立 worker              |
| 故障域                     | 共用事件循环；`process.exit`、OOM、同步阻塞会连宿主一起带走 | worker 故障被隔离，服务本身还活着 |
| 提前结束迭代               | 请求取消                                                    | 仅停止观察                        |
| 回放                       | 无                                                          | 有界，按原始身份与序号            |
| `environment.streamLimits` | 支持                                                        | 拒绝                              |
| 关闭                       | `shutdown()` 后看 `cleanup`                                 | `close()` 后看 `complete`         |

长期驻留的桌面宿主建议走 Kernel，这是推荐路径。选直接 Core 应当是有意的：你接受共用故障域，并且自己管理执行器生命周期。两条路都不需要 Extra。

## 导入与分发

private workspace 包：源码和子模块宿主从 `@mininglamp-oss/octo-runtime-executor-core` 导入。发行版使用者走 `@mininglamp-oss/octo-runtime/executor-core`。

## 延伸阅读

- [实现与导出](src/index.ts)、[输入准备](src/invoke-input.ts)、[本轮渲染](src/model-input.ts)、[watchdog](src/watchdog.ts)。
- [Kernel](../octo-runtime-executor-kernel/README.zh.md)、[输入参考](../../docs/zh-CN/reference/invoke-input.md)、[输出与控制](../../docs/zh-CN/reference/output-and-control.md)。
- [执行器测试](../../test/executor-core.test.js)、[清理预算测试](../../test/executor-cleanup-budget.test.js)。
