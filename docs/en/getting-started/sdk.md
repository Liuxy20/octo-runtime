# SDK Integration

## Choose The npm Package

| Need | Install | Entry |
| --- | --- | --- |
| Consume an existing local Kernel | `@mininglamp-oss/octo-runtime-client` | `attachKernel({ endpoint })` |
| Own Kernel/Extra services or use Core directly | `@mininglamp-oss/octo-runtime` | Native service factories, then `kernel.client`; direct Core remains explicit |

The client is independently installable and includes shared protocol types, helpers and schemas, without the CLI, Core, Adapters or Extras. It never starts a Kernel. [Client package reference](../../../packages/octo-runtime-client/README.md) describes exports, cancellation and ownership.

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime-client/protocol";

// 应用拥有连接；endpoint 对应服务由宿主持有，须已启动。
export async function execute(endpoint: string, input: InvokeInput) {
  const client = attachKernel({ endpoint });
  try {
    for await (const event of client.invoke({ ...input, protocol_mode: "canonical" })) {
      console.log(event);
    }
  } finally {
    // 业务先完成持久化/投递；关闭连接不取消已受理的 Run。
    client.close();
  }
}
```

Both packages are published at matching versions from the same tag. Runtime bundles its own client/protocol; each tgz remains independently installable offline. Existing Runtime `/executor-kernel` and `/protocol` imports remain supported. Two installed distributions can contain separate module instances: use the error class from the API that produced the error, or its public `code`; cross-distribution function identity and `instanceof` are not guaranteed.

Package versions are separate from IPC v1, Run 7 and Context v3. Matching release pairs are supported; other combinations need explicit verification against the same wire contracts. Status rejects unsupported IPC versions before submission; there is no new negotiation, downgrade or automatic execution replay. Schema exports are `/protocol/schema.json`, `/protocol/ipc-schema.json`, `/protocol/ipc-fixtures.json` and `/protocol/behavior.json`. Transport remains local Unix sockets / Windows named pipes under the existing OS-account trust boundary.

The POSIX Kernel address is `<home>/executor-kernel.sock`; Windows pipe names and Extra control addresses are unchanged. This is a breaking address change: stop old processes, update Kernel and all clients/Extras together, then restart.

[简体中文](../../zh-CN/getting-started/sdk.md) | [Documentation](../README.md)

Electron/Node.js hosts import their selected modules natively. Choose your own loading approach; **pnpm workspace + Git submodule** is one option for source integration. Examples use source workspace package names; published equivalents include `/executor-kernel`, `/host`, and `/extras/channel-gateway`.

Home ownership, validation and migration are described in [Runtime Home](../reference/runtime-home.md). SDK has no default Home. Kernel and IPC Extra services require a prepared Home; direct Extras can omit it.

## Choose Extra execution

An embedded host can borrow its existing Core without a Kernel listener or Runtime Home:

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime/adapters/codex";
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as channelGateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import { config, dependencies } from "./host-config.js";

// 宿主持有 Core；注册不执行模型调用，也不证明 Provider 已就绪。
const executor = new AgentExecutor();
executor.register(createCodexAdapter());
const extra = createExtraService({
  execution: { kind: "direct", executor },
  module: channelGateway, config, dependencies
});
await extra.initialize();

export async function shutdown() {
  // 宿主先停止新业务，并在共享 Core 的所有使用方结束后关闭 Core。
  const extraCleanup = await extra.close();
  if (!extraCleanup.complete) throw new Error("EXTRA_CLEANUP_INCOMPLETE");
  const cleanup = await executor.shutdown();
  if (cleanup.cleanup !== "complete") throw new Error("EXECUTOR_CLEANUP_INCOMPLETE");
}
```

`config` and `dependencies` keep the existing Channel Gateway contracts below. Several Extras may share this executor; each controls only its own calls. Different executor objects may host Extras with the same name. Closing an Extra never shuts down the borrowed Core.

For an independently hosted Kernel, use `createExtraService({ home, execution: { kind: "ipc", endpoint }, module, config, dependencies })`. The Kernel owner constructs the service as shown below. Extra connects to that existing endpoint; it does not launch, restart, or stop Kernel. Legacy `{ home, endpoint, ... }` remains supported, but combining `endpoint` with `execution` is rejected.

Both modes expose `context.execution`. Stopping observation does not cancel admitted work; explicit cancellation and Extra shutdown do. Direct execution shares the host's failure domain and has bounded observation history, without IPC reconnection or durable replay guarantees. Both paths use Core's registered Adapter scope: compatible Codex calls reuse a resident app-server. Extra closure releases its own calls; the Core/Kernel owner closes the service and checks cleanup. See the [Codex lifecycle and limits](../../../packages/octo-runtime-adapter-codex/README.md).

## 1. Quick Start: KernelService

| Purpose | Signature | Notes |
| --- | --- | --- |
| Create | `createKernelService(options: KernelServiceOptions): KernelService` | Requires an existing `home: string`, `endpoint: string` and `adapters: readonly HostedAdapter[]`; actual objects |
| Derive address | `componentEndpoint(home: string): string` | Local socket / Named Pipe address, not the Home directory itself |
| Initialize | `kernel.initialize({ signal? }?): Promise<void>` | Makes `kernel.client` available |
| Service status | `kernel.status(): Promise<KernelServiceStatus>` | Lifecycle and Kernel state |
| Close | `kernel.close(): Promise<ServiceCleanupResult>` | The host closes its service and checks `complete` |

The host prepares Provider installation and authentication. Integration does not require an invocation:

```ts
import { createKernelService } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime-host-sdk";
import { createCodexAdapter } from "@mininglamp-oss/octo-runtime-adapter-codex";

import { mkdir } from "node:fs/promises";

// 宿主按产品设计选择根并准备；SDK 不选择默认目录。
const home = "/absolute/app-runtime-home";
await mkdir(home, { recursive: true });
const endpoint = componentEndpoint(home);
const kernel = createKernelService({ home, endpoint, adapters: [createCodexAdapter()] });
await kernel.initialize();
// 原生 SDK 已取得 RPC 客户端；无需 attachKernel，也无需立即发起 AgentRun。
const client = kernel.client;
```

Native SDK hosts use `kernel.client`, which calls Kernel through local RPC. `attachKernel` is for an independent application in another process connecting to an existing Kernel; it is not part of native service composition.

```ts
// 应用退出时执行；如果创建了 Extra，先按下一章关闭 Extra。
const cleanup = await kernel.close();
if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
```

## 2. Add ChannelGateway ExtraService

Create Gateway when you need Octo IM integration. Kernel alone does not require an Extra.

| Purpose | Signature | Notes |
| --- | --- | --- |
| Create Extra | `createExtraService<D>(options: ExtraServiceOptions<D>): ExtraService` | Supply the prepared `home`; reuse the Kernel `endpoint`; import `module` natively; `config` is JSON and `dependencies` contains host functions |
| Initialize | `gateway.initialize({ signal? }?): Promise<void>` | Initializes the plugin; does not prove the Bot is online |
| Inspect | `gateway.status(): Promise<ExtraServiceStatus>` | Lifecycle, Kernel availability, and plugin state |
| Close | `gateway.close(): Promise<ServiceCleanupResult>` | Drains this Extra without closing shared Kernel |

Continue after Kernel initialization above. This example reads host environment variables; your application may use its own configuration service. `GATEWAY_WORKDIR` must be an existing absolute directory.

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime-host-sdk";
import * as channelGateway from "@mininglamp-oss/octo-runtime-extra-channel-gateway";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

// 使用上一章已初始化的 Kernel endpoint；配置/凭据来源由宿主决定。
const gateway = createExtraService({
  home,
  execution: { kind: "ipc", endpoint },
  module: channelGateway,
  config: {
    bots: [{
      api_url: required("GATEWAY_API_URL"),
      bot_id: required("GATEWAY_BOT_ID"),
      bf_token: required("GATEWAY_BOT_TOKEN"),
      adapter: { adapter_type: "codex", workdir: required("GATEWAY_WORKDIR") }
    }]
  },
  dependencies: {}
});
await gateway.initialize();
console.log(await gateway.status());
```

Gateway runs natively in the host and manages its own RPC client internally; callers do not call `attachKernel`. At application shutdown, use this sequence instead of the Kernel-only close block:

```ts
// 应用退出时停止新业务；先关闭 Gateway，再关闭自己拥有的 Kernel。
const extraCleanup = await gateway.close();
const kernelCleanup = await kernel.close();
if (!extraCleanup.complete || !kernelCleanup.complete)
  throw new Error("RUNTIME_CLEANUP_INCOMPLETE");
// 确认业务读写结束后，再关闭宿主数据库等共享依赖。
```

Initialization failure also requires closing created services; `ServiceInitializationError` carries failure and cleanup details. Preserve errors and host resources still in use when cleanup is incomplete.

## 3. Advanced Integration

[Host dependencies and examples](../guides/sdk-dependencies.md): dynamic data with `loadContexts`, session storage with `createSessionStore`, and dependency injection for custom Extras.

## 4. Optional: Use AgentRun

After integration, read [invocation, events, and control](../guides/agent-runs.md) when business code needs to invoke AgentRun. Invocation, event consumption, interaction, and cancellation are not required integration steps; Gateway invokes in response to incoming messages.

## Startup failures

See the [startup diagnostic contract and catalog](../guides/startup-diagnostics.md) for stable code branching, safe resource context, cleanup and CLI JSON compatibility.
