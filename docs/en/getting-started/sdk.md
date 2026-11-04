# SDK Integration

Persistent POSIX Kernel endpoint: `<home>/executor-kernel.sock`. Windows retains the existing Home-hash named pipe. Before replacing an old Kernel, follow the [stop/upgrade/restart procedure](../guides/kernel-endpoint-upgrade.md); upgrade attached clients and independent Extras together.

[简体中文](../../zh-CN/getting-started/sdk.md) | [Documentation](../README.md)

Electron/Node.js hosts import their selected modules natively. Choose your own loading approach; **pnpm workspace + Git submodule** is one option for source integration. Examples use source workspace package names; published equivalents include `/executor-kernel`, `/host`, and `/extras/channel-gateway`.

Home ownership, validation and migration are described in [Runtime Home](../reference/runtime-home.md). SDK has no default Home.

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
  endpoint,
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
