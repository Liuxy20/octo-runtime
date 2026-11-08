# SDK Integration

## Choose The npm Package

| Need | Install | Entry |
| --- | --- | --- |
| Consume an existing local Kernel | `@mininglamp-oss/octo-runtime-client` | `attachKernel({ endpoint })` |
| Own Kernel services or use Core directly | `@mininglamp-oss/octo-runtime` | Native service factories, then `kernel.client`; direct Core remains explicit |

The client is independently installable and includes shared protocol types, helpers and schemas, without the CLI, Core, Adapters. It never starts a Kernel. [Client package reference](../../../packages/octo-runtime-client/README.md) describes exports, cancellation and ownership.

```ts
import { attachKernel } from "@mininglamp-oss/octo-runtime-client";
import type { InvokeInput } from "@mininglamp-oss/octo-runtime-client/protocol";

// 应用拥有连接；endpoint 对应服务由宿主持有，须已启动。
export async function execute(endpoint: string, input: InvokeInput) {
  const client = attachKernel({ endpoint });
  try {
    const { inputs: parts, sessionId, providerSession, agentEnv, ...content } = input;
    for await (const event of client.invoke({ ...content, parts, protocol_mode: "canonical" }, sessionId, providerSession, agentEnv)) {
      console.log(event);
    }
  } finally {
    // 业务先完成持久化/投递；关闭连接不取消已受理的 Run。
    client.close();
  }
}
```

Both packages are published at matching versions from the same tag. Runtime bundles its own client/protocol; each tgz remains independently installable offline. Existing Runtime `/executor-kernel` and `/protocol` imports remain supported. Two installed distributions can contain separate module instances: use the error class from the API that produced the error, or its public `code`; cross-distribution function identity and `instanceof` are not guaranteed.

Package versions are separate from IPC v2, Run 7 and Context v3. Matching release pairs are supported; other combinations need explicit verification against the same wire contracts. Status rejects unsupported IPC versions before submission; there is no new negotiation, downgrade or automatic execution replay. Schema exports are `/protocol/schema.json`, `/protocol/ipc-schema.json`, `/protocol/ipc-fixtures.json` and `/protocol/behavior.json`. Transport remains local Unix sockets / Windows named pipes under the existing OS-account trust boundary.

The POSIX Kernel address is `<home>/executor-kernel.sock`; Windows uses a named pipe.

[简体中文](../../zh-CN/getting-started/sdk.md) | [Documentation](../README.md)

Electron/Node.js hosts import Adapter objects and construct Kernel services through the public /host SDK.

The host prepares an absolute Home directory. SDK does not create or select the root; see [Runtime Home](../reference/runtime-home.md).

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
// 应用退出前先完成所属业务的执行排空和持久化。
const cleanup = await kernel.close();
if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
```

## 3. Advanced Integration

[Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides an independent business registration SDK.

## 4. Optional: Use AgentRun

After integration, read [invocation, events, and control](../guides/agent-runs.md) when business code needs to invoke AgentRun. Invocation, event consumption, interaction, and cancellation are not required integration steps; Gateway invokes in response to incoming messages.

## Startup failures

See the [startup diagnostic contract and catalog](../guides/startup-diagnostics.md) for stable code branching, safe resource context, cleanup and CLI JSON compatibility.

Business channels use the independent `@mininglamp-oss/octo-channel-gateway` package and only the public client.
