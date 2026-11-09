# SDK 接入

## 选择接入方式

| 需求 | 安装 | 入口 |
| --- | --- | --- |
| 消费已有的本地 Kernel | `@mininglamp-oss/octo-runtime-client` | `attachKernel({ endpoint })` |
| 由 CLI 提供 Kernel 服务 | `@mininglamp-oss/octo-runtime` | 启动 `octo-runtime start`，独立 App 通过 client 调用 |
| 应用内原生拥有 Kernel，或显式直接调用 Core | 源码 workspace 中的 Kernel/Core、公共辅助包及所选 Adapter | 原生服务工厂，初始化后使用 kernel.client；不依赖 CLI 聚合包 |

client 可以独立安装，提供协议类型、辅助函数和 schema，不包含 CLI、Core、Adapter，也不启动 Kernel。公开入口、取消与所有权见 [client 包参考](../../../packages/octo-runtime-client/README.md)。

CLI 发行物负责其内置装配，`octo-runtime-client` 不包含或加载 Adapter。纯原生嵌入统一从源码 workspace 接入：宿主声明实际使用的包，再直接 import 或动态 import 对应 Adapter；完整包不提供 `/adapters/codex`、`/adapters/dsh` 聚合导出。连接已有 Kernel 的独立 App 只需 client，通过 AgentEnv 选择服务端已注册的 Adapter，无须 Runtime checkout 或 Adapter 依赖。

例如原生宿主只使用 Codex 时，在自己的 pnpm workspace 应用中声明以下依赖；workspace 必须包含这些源码包及其传递依赖，先完成所需包的构建。只使用 OpenClaw 时，把 Codex 依赖换成 `@mininglamp-oss/octo-runtime-adapter-openclaw`，不安装或 import Codex Adapter。

```json
{
  "dependencies": {
    "@mininglamp-oss/octo-runtime-executor-kernel": "workspace:*",
    "@mininglamp-oss/octo-runtime-host-sdk": "workspace:*",
    "@mininglamp-oss/octo-runtime-adapter-codex": "workspace:*"
  }
}
```

Adapter 在 Kernel 初始化前完成构造和注册；需要按产品配置加载时，由宿主选择 import 集合。未选择的 Adapter 不进入该宿主的依赖或加载集合。CLI 默认会导入其 manifest 中的全部装配项；Codex 进程的首次调用惰性启动是另一层行为。直接 Core 是显式高级选择，执行、取消及退出清理由原生宿主负责。完整场景和所有权见[架构约束](../concepts/architecture.md)。

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
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { createCodexAdapter, createManagedCodexEngine } from "@mininglamp-oss/octo-runtime-adapter-codex";

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

## 2. AgentEnv 与 Adapter 私有配置

宿主把每轮配置放在 `AgentEnv.items`，Core 复制本轮快照并保序透传，由对应 Adapter 读取。跨 Harness 共用的模型选择使用公共 `octo.execution/model` bean；仅供某个 Adapter 使用的参数，通过双方约定的 namespace/name 传递，再用 `agentEnvItem<T>(req.agentEnv, namespace, name)` 读取。私有 bean 无须登记公共 schema、生成公共类型或新增配置投影。

下面以自定义 `my-adapter` 为例；使用该片段的源码包还须直接声明 `octo-runtime-adapter-sdk` 和 `octo-runtime-protocol` 的 workspace 依赖。`agentEnv` 由宿主作为 `client.invoke` 的第四个参数传入；`invokeMyAdapter` 展示该 Adapter 内部读取配置并映射原生 client 的片段，实际 Adapter 注册与生命周期见[构造示例](../../examples/custom-adapter.mts)。

```ts
import { agentEnvItem, invocationModel } from "@mininglamp-oss/octo-runtime-adapter-sdk";
import type { AgentEnv, InvokeRequest } from "@mininglamp-oss/octo-runtime-protocol";

// 宿主构造本轮信封；agentId 仅属于宿主与 my-adapter 的私有约定。
const agentEnv: AgentEnv = {
  schema: "octo.context-envelope/v3",
  items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "my-adapter" } },
    { namespace: "octo.execution", name: "model", payload: { selection: { id: "provider/model" } } },
    { namespace: "adapter.my-adapter", name: "options", payload: { agentId: "researcher" } }
  ]
};

interface MyAdapterOptions {
  agentId: string;
}

interface MyHarnessClient {
  execute(request: InvokeRequest, options: { agentId: string; model?: string }): Promise<void>;
}

export function invokeMyAdapter(req: InvokeRequest, client: MyHarnessClient) {
  const options = agentEnvItem<MyAdapterOptions>(req.agentEnv, "adapter.my-adapter", "options");
  // 泛型不做运行时校验；消费该私有 bean 的 Adapter 检查自己的字段。
  if (!options || typeof options.agentId !== "string" || !options.agentId.trim())
    throw new TypeError("MY_ADAPTER_AGENT_ID_REQUIRED");

  // 公共模型 helper 也只读取本轮显式值，Provider 映射和校验归 Adapter。
  const model = invocationModel(req);
  if (model !== undefined && (typeof model !== "string" || !model.trim()))
    throw new TypeError("MY_ADAPTER_MODEL_INVALID");
  return client.execute(req, { agentId: options.agentId, ...(model === undefined ? {} : { model }) });
}
```

`agentEnvItem` 精确匹配 namespace/name，条目不存在时返回 `undefined`；返回值是原 payload 引用，不是副本，Adapter 应只读使用。泛型只提供 TypeScript 类型提示，私有字段的必填条件、默认值和校验完全归消费方；其他 Adapter 忽略不属于自己的 item，不把私有配置加入公共模型。`invocationModel` 读取公共 bean 的 `selection.id`，缺失时返回 `undefined`，不补默认模型、不查询目录。业务材料和提示词仍放在 `inputs`，私有 item 不会自动进入模型输入。完整责任边界见[架构说明](../concepts/architecture.md)。

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
  items: [
    { namespace: "octo.execution", name: "adapter", payload: { type: "codex" } },
    { namespace: "octo.execution", name: "workspace", payload: { path: workdir } }
  ]
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
