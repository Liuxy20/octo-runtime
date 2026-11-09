# SDK 接入

## 选择 npm 包

| 需求 | 安装 | 入口 |
| --- | --- | --- |
| 消费已有的本地 Kernel | `@mininglamp-oss/octo-runtime-client` | `attachKernel({ endpoint })` |
| 拥有 Kernel 服务，或显式直接调用 Core | `@mininglamp-oss/octo-runtime` | 原生服务工厂，初始化后使用 kernel.client；直接 Core 仍是显式选择 |

client 可以独立安装，提供协议类型、辅助函数和 schema，不包含 CLI、Core、Adapter，也不启动 Kernel。公开入口、取消与所有权见 [client 包参考](../../../packages/octo-runtime-client/README.md)。

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime-client/protocol";

// 应用拥有连接；endpoint 对应服务由宿主持有，须已启动。
export async function execute(endpoint: string, input: InvokeInput) {
  const client = attachKernel({ endpoint });
  try {
    const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
    for await (const event of client.invoke(
      { ...content, parts, protocol_mode: "canonical" },
      sessionId,
      providerSession,
      agentEnv
    )) {
      console.log(event);
    }
  } finally {
    // 业务先完成持久化/投递；关闭连接不取消已受理的 Run。
    client.close();
  }
}
```

两个包从同一 tag 同版本发布。runtime 内置自己的 client/protocol，任一 tgz 均可单独离线安装；完整 SDK 原有 `/executor-kernel`、`/protocol` 路径保持。应用同时安装两种发行物时可能有两个模块副本：错误判断使用产生错误的 API 对应的类，或公开 code，不依赖跨发行物的函数 ===、instanceof 或内部拒绝证据互认。

npm 版本与 IPC v2、Run 7、Context v3 分别管理。同次发行组合属于支持范围；其他组合需要按相同 wire 合同明确验证。status 在提交前拒绝不支持的 IPC 版本，不增加协商、降级或自动重放。独立 client 在 `/protocol/schema.json` 和 `/protocol/ipc-schema.json` 提供两个 Draft-07 Schema，另在原有 `/protocol/ipc-fixtures.json` 路径提供一致性样本。`/protocol/behavior.json` 已删除，默认值归客户端实现。IPC Schema 标识改为 `kernel-ipc:v2`，实际 wire 版本不变。扩展语义检查及闲置导出删除清单见[校验边界与升级说明](../../../packages/octo-runtime-protocol/README.zh.md)。传输仍限定本地 Unix socket/Windows named pipe 和现有系统账号信任边界。

## 1. 快速接入 KernelService

| 用途 | 签名 | 说明 |
| --- | --- | --- |
| 创建服务 | `createKernelService(options: KernelServiceOptions): KernelService` | 必填已存在目录 `home: string`、`endpoint: string`、`adapters: readonly HostedAdapter[]`，接收实际对象 |
| 派生地址 | `componentEndpoint(home: string): string` | 本地 socket / Named Pipe 地址，不能把 Home 目录直接当 endpoint |
| 初始化 | `kernel.initialize({ signal? }?): Promise<void>` | 成功后取得 `kernel.client` |
| 服务状态 | `kernel.status(): Promise<KernelServiceStatus>` | 生命周期及 Kernel 状态 |
| 关闭 | `kernel.close(): Promise<ServiceCleanupResult>` | 宿主负责关闭并检查 `complete` |

Provider 的安装、认证由宿主准备。这里只完成服务接入，不需要发起一次调用：

```ts
import { createKernelService, componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { createCodexAdapter, createManagedCodexEngine } from "@mininglamp-oss/octo-runtime/adapters/codex";

import { mkdir } from "node:fs/promises";

// 宿主按产品设计选择根并准备；SDK 不选择默认目录。
const home = "/absolute/app-runtime-home";
await mkdir(home, { recursive: true });
const endpoint = componentEndpoint(home);
const owner = createManagedCodexEngine({ codexHome: "/absolute/app-codex-home" });
const kernel = createKernelService({ home, endpoint,
  adapters: [createCodexAdapter({ engine: owner.provider })],
  serviceProcesses: () => owner.processes(),
  async finalizeHostResources(deadline) {
    const result = await owner.close({ deadline });
    if (!result.complete) throw new Error("ENGINE_CLEANUP_INCOMPLETE", { cause: result });
  } });
try {
  await kernel.initialize();
} catch (error) {
  const deadline = performance.now() + 5000;
  owner.beginShutdown();
  const results = await Promise.allSettled([kernel.close()]);
  results.push(...await Promise.allSettled([owner.close({ deadline })]));
  throw new AggregateError([error, ...results], "HOST_INITIALIZATION_FAILED");
}
// 原生 SDK 已取得 RPC 客户端；无需 attachKernel，也无需立即发起 AgentRun。
const client = kernel.client;
```

原生 SDK 宿主使用 `kernel.client`，它通过本地 RPC 调用 Kernel。`attachKernel` 用于另一个进程中的独立应用连接已有 Kernel，不属于原生服务装配步骤。

```ts
// 应用退出前先完成所属业务的执行排空和持久化。
const deadline = performance.now() + 5000;
owner.beginShutdown();
const results = await Promise.allSettled([kernel.close()]);
  results.push(...await Promise.allSettled([owner.close({ deadline })]));
if (results.some((r) => r.status === "rejected" || !r.value.complete))
  throw new AggregateError(results, "HOST_CLEANUP_INCOMPLETE");
```

## 3. 高级接入

CODEX_HOME 必须由宿主选择、准备并显式注入，关闭进程不删除目录、认证或会话。上例的 owner 是宿主独占资源；更完整的顺序关闭和初始化回滚见[可编译示例](../../examples/codex-service.mts)。不再导出 codexAdapter 单例或接受旧构造参数。

业务已有 Codex Engine 时，直接 createCodexAdapter({engine: businessProvider})。CodexEngineProvider.acquire 提供可独立释放的 channel 和本轮 MCP 配置，全部共享 RPC 关联由业务 provider 维护。关闭借用的 Kernel 不调用业务 owner.beginShutdown/close。其他黑盒 Adapter 可以采用任意构造参数，包括具体 client、函数、配置和多个对象；只要求构造结果满足注册执行合同，见[构造示例](../../examples/custom-adapter.mts)和[架构边界](../concepts/architecture.md)。

[Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 提供独立业务注册 SDK。

## 4. 可选：使用 AgentRun

服务接入完成后，业务需要主动执行 AgentRun 时再阅读[调用、事件与控制](../guides/agent-runs.md)。`invoke`、事件消费、交互和取消不属于接入必做步骤；Gateway 会按收到的消息发起调用。

## 调用前准备工作目录

本地 AgentRun 必须由调用方先成功创建绝对工作目录，再通过 仅含 path 的 `octo.execution/workspace` 传入。SDK 不默认取 cwd，不创建目录，也不在续接/恢复时重建。Runtime Home 是独立的运维目录；OpenClaw 等自行管理工作区的 Agent 可以省略本地覆盖。见[输入校验与 workdir 错误码](../reference/invoke-input.md)。

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 应用先创建目录，再提交普通输入；目录复用和最终清理由应用决定。
const workdir = await mkdtemp(join(tmpdir(), "my-agent-"));
const agentEnv = {
  schema: "octo.context-envelope/v3" as const,
  workdir,
  items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "codex" } }]
};
for await (const event of client.invoke(
  [{ type: "text", text: "Summarize this directory." }],
  undefined,
  undefined,
  agentEnv
)) {
  console.log(event);
}
```

所有使用该目录的执行结束并确认自有资源释放后，应用再决定清理。[DSH 示例](../../examples/dsh-invoke.mts) 展示调用方创建临时目录、消费终态并检查清理的过程。独立 Channel Gateway 仍输出已删除的 fixed-mode payload，且另有提示词迁移要求；采用本次发行前须另行升级该消费者。

## 启动失败

稳定码分支、安全资源 context、清理事实及 CLI JSON 兼容方式见[启动诊断合同与目录](../guides/startup-diagnostics.md)。

[English](../../en/getting-started/sdk.md)

业务渠道使用独立 `@mininglamp-oss/octo-channel-gateway`，仅依赖公开 client。
