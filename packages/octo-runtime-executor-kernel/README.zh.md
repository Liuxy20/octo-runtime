# Executor Kernel

[English](README.md) | [包导航](../README.zh.md)

把 [Executor Core](../octo-runtime-executor-core/README.zh.md) 放进独立的 worker 进程，并通过本地 IPC 暴露出来。宿主持有 Kernel 服务，业务代码对着 `KernelClient` 说话，worker 是你自己的一个小文件，里面注册要发布的 Adapter，由 Kernel 拉起。当一个 Provider 崩溃、OOM 或 `process.exit` 不能把外面整个应用带走时，就该用它。

## 什么时候用它

- 长期驻留的桌面或 CLI 宿主：执行被隔离、被监督、可重启。
- 多个调用方——UI、Extra、自动化——共用一个执行服务。
- 连接断开后需要有界地续读输出。

跑一次 prompt 就退出的短脚本，直接用 Core 更省事。

## 要接的三块

| 角色       | 入口                                                  | 职责                               |
| ---------- | ----------------------------------------------------- | ---------------------------------- |
| 业务调用方 | `attachKernel({ endpoint })`，或注入的 `KernelClient` | 持有自己的连接与调用策略           |
| 装配入口   | `createKernelService(options)`，然后 `initialize()`   | 持有服务，退出时关闭并读取清理结果 |
| Worker     | 自己的入口文件里调 `serveWorker([...adapters])`       | 注册 Adapter，通过 Core 提供执行   |

socket 或管道属于调用进程，隔离来自 worker，不来自服务进程。

## 发起一次调用

`worker.mjs` —— 你自己的文件，Kernel 只负责拉起它：

```js
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

serveWorker([dshAdapter]);
```

在宿主进程里构造服务。这一步不做 I/O，`initialize()` 之前不会监听任何地址：

```ts
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { componentEndpoint, createKernelService } from "@mininglamp-oss/octo-runtime/host";

const home = process.env.OCTO_HOME ?? process.cwd();
const kernel = createKernelService({
  endpoint: componentEndpoint(home), // socket on POSIX, named pipe on Windows
  workerEntrypoint: fileURLToPath(new URL("./worker.mjs", import.meta.url)),
  stateDirectory: join(home, "state")
});
```

然后调用并关闭：

```ts
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";

await kernel.initialize();
try {
  const input = InvokeInput.check({
    inputs: [{ type: "text", text: "Summarize the last commit." }],
    approvalMode: "full_access",
    contexts: {
      schema: "octo.context-envelope/v3",
      items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
    }
  });
  let terminal: string | undefined;
  for await (const event of kernel.client.invoke({ ...input, protocol_mode: "canonical" })) {
    if (event.type === "message.delta" && event.payload.channel === "final")
      process.stdout.write(event.payload.text ?? "");
    if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
      terminal = event.type;
  }
  if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
} finally {
  const cleanup = await kernel.close();
  if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
}
```

`stateDirectory` 可选，但孤儿清理记录要靠它跨重启保留。

## 从另一个进程接入

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";

export async function runAgainstKernel(home: string, input: InvokeInput): Promise<void> {
  const client = attachKernel({ endpoint: componentEndpoint(home) });
  try {
    let terminal: string | undefined;
    for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
      if (["run.completed", "run.failed", "run.cancelled"].includes(event.type))
        terminal = event.type;
    }
    if (terminal !== "run.completed") throw new Error(terminal ?? "RUN_TERMINAL_MISSING");
  } finally {
    client.close(); // does not cancel the run and does not stop the service
  }
}
```

消费方必须处理所选 Provider 的交互请求。[attach.mts](../../docs/examples/attach.mts) 演示连接所有权与交互回复，[service.mts](../../docs/examples/service.mts) 演示持有服务和区分执行错误、清理错误。

## 服务生命周期

构造不做 I/O。`initialize({ signal? })` 之后 `kernel.client` 可用，`status()` 会报告 phase、endpoint、pid 和 worker 状态。`close()` 停止接纳，并在共用的 5 秒预算内协调关闭，返回 `ServiceCleanupResult`；`closed` Promise 也会以同一个值结束。`initialize()` 失败时抛 `ServiceInitializationError`，里面带着原始 `cause` 和当时能做到的 `cleanup`。

`closed` 或 leader 进程停掉都不代表清理完成——要看 `complete`。先关自己拥有的 Extra，再关自己拥有的 Kernel，Extra 不可以关闭共享 Kernel 或别人的 Run。接入一个 client 不会让你变成服务所有者。

## 取消与观察

| 操作                                          | 含义                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `invoke(input, { signal })`                   | 提交前 abort：不会提交。提交后 abort：请求取消这次调用，并继续观察它的收尾。 |
| `cancelInvocation(invocationId)`              | 取消本 client 发起的调用。`accepted` 不是终态。                              |
| 迭代器 `return()`、结束订阅、`client.close()` | 停止观察。已接纳的执行继续跑，服务不受影响。                                 |
| Extra 或服务 `close()`                        | 按所有者显式的取消与清理策略处理。                                           |

一个 client 最多跟踪 128 个进行中或结果未知的调用。普通使用者交给服务关闭来管；高级接入方可以用 `invocations.stopAdmission()` 和 `drain({ deadline, reason })`，后者确认的是执行状态，不是投递或数据库落盘。

底层 `submit`、`get`、`subscribe`、`cancel`、`respond`、`respondNative` 仍然可用，适合自己管理完整 `RunRef` 所有权的调用方；它们不会自动进入高层登记表。见 [IPC 参考](../../docs/zh-CN/reference/kernel-ipc.md)。

## 恢复与限额

- 传输是每个连接一个 UTF-8、LF 结尾的 JSON-RPC 2.0 请求，走 Unix socket 或 Windows 命名管道。Worker 执行走 stdio NDJSON，另有一条 Node IPC 通道传监督心跳。
- 提交回执丢失时，按原始身份查询，绝不重新提交。流修复沿用原始身份和最后连续序号；出现空洞、过期或实例变更就显式失败。
- Worker 故障先做自有进程清理，再做有界快速重试，最后转低频恢复。清理或所有权失败会阻止替换。新 worker 只接新 Run，不回放被打断的；丢了 worker 的活动 Run 报 `lost`，已经保留的终态继续保留。
- 默认额度：单个 Run 4,096 帧或 32 MiB，全局 128 MiB 或 128 个 Run，终态保留 120 秒。Kernel 最多 64 个连接、16 个订阅；一个 client 最多 32 个在途连接。这些只是有界的传输记录——它们不是持久历史，也不代表进程 RSS。
- POSIX 端点依赖 socket 权限，Windows 用自己的命名管道机制。进程树清理因平台而异，leader 退出不等于后代进程都已退出。要看清清理证据，不要靠推断。

## 导入与分发

private workspace 包。应用从 `@mininglamp-oss/octo-runtime/executor-kernel` 拿 `attachKernel`、`KernelClient` 和 `serveWorker`。`@mininglamp-oss/octo-runtime/host` 也再导出 `createKernelService` 与端点工具，但实现留在本包。Kernel 和 Core 都不依赖 Host SDK。

## 延伸阅读

- [导出](src/index.ts)、[服务](src/service.ts)、[客户端](src/client.ts)、[worker 入口](src/serve.ts)、[源窗口](src/host-run-service.ts)、[监督器](src/supervisor.ts)。
- [Core](../octo-runtime-executor-core/README.zh.md)、[Host SDK](../octo-runtime-host-sdk/README.zh.md)、[SDK 入门](../../docs/zh-CN/getting-started/sdk.md)、[模块加载](../../docs/zh-CN/concepts/module-loading.md)。
- [客户端测试](../../test/kernel-clients.test.js)、[worker 监督测试](../../test/kernel-worker-supervision.test.js)、[源窗口测试](../../test/host-run-service.test.js)。
