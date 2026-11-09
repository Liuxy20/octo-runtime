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

Both packages are published at matching versions from the same tag. Runtime bundles its own client/protocol; each tgz remains independently installable offline. Existing Runtime `/executor-kernel` and `/protocol` imports remain supported. Two installed distributions can contain separate module instances: use the error class from the API that produced the error, or its public `code`; cross-distribution function identity and `instanceof` are not guaranteed.

Package versions are separate from IPC v2, Run 7 and Context v3. Matching release pairs are supported; other combinations need explicit verification against the same wire contracts. Status rejects unsupported IPC versions before submission; there is no new negotiation, downgrade or automatic execution replay. The standalone client exports two Draft-07 schemas at `/protocol/schema.json` and `/protocol/ipc-schema.json`, with separate conformance samples at the preserved `/protocol/ipc-fixtures.json` path. `/protocol/behavior.json` is removed; client defaults belong to its implementation. The IPC Schema identifier now ends in `kernel-ipc:v2`, matching the unchanged wire version. See [validation boundaries and upgrade notes](../../../packages/octo-runtime-protocol/README.md) for custom semantic checks and removed legacy exports. Transport remains local Unix sockets / Windows named pipes under the existing OS-account trust boundary.

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

Native SDK hosts use `kernel.client`, which calls Kernel through local RPC. `attachKernel` is for an independent application in another process connecting to an existing Kernel; it is not part of native service composition.

```ts
// 应用退出前先完成所属业务的执行排空和持久化。
const deadline = performance.now() + 5000;
owner.beginShutdown();
const results = await Promise.allSettled([kernel.close()]);
  results.push(...await Promise.allSettled([owner.close({ deadline })]));
if (results.some((r) => r.status === "rejected" || !r.value.complete))
  throw new AggregateError(results, "HOST_CLEANUP_INCOMPLETE");
```

## 3. Advanced Integration

The host selects, prepares and explicitly supplies CODEX_HOME. Process shutdown never deletes its directory, credentials or sessions. This example exclusively owns its Engine; see the [compiled example](../../examples/codex-service.mts) for sequential shutdown and initialization rollback. The codexAdapter singleton and old constructor options are removed.

For an existing Codex Engine use createCodexAdapter({engine: businessProvider}). CodexEngineProvider.acquire supplies an independently releasable channel and invocation MCP configuration; the business provider coordinates shared RPC correlation. Closing a borrowing Kernel never calls the business owner's beginShutdown/close. Other black-box adapters may accept arbitrary arguments: concrete clients, functions, configuration or multiple objects. Only the constructed registration contract is shared; see the [construction example](../../examples/custom-adapter.mts) and [architecture](../concepts/architecture.md).

[Channel Gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) provides an independent business registration SDK.

## 4. Optional: Use AgentRun

After integration, read [invocation, events, and control](../guides/agent-runs.md) when business code needs to invoke AgentRun. Invocation, event consumption, interaction, and cancellation are not required integration steps; Gateway invokes in response to incoming messages.

## Prepare The Working Directory

Before a local AgentRun, the caller must successfully prepare an absolute working directory and pass it through `octo.execution/workspace.payload.path` or path-only `octo.execution/workspace`. SDK does not default to cwd, create a directory, or restore a missing one during continuation/recovery. Runtime Home is a separate operational directory. OpenClaw and other Agents that own their workspace can omit the local override. See [input validation and workdir error codes](../reference/invoke-input.md).

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

Keep the directory until all executions using it have finished and owned resources have been released. The [DSH example](../../examples/dsh-invoke.mts) shows caller-created temporary storage with terminal consumption and cleanup checks. The independent Channel Gateway still emits the removed fixed-mode payload and has an additional prompt migration requirement; update that consumer separately before adopting this release.

## Startup failures

See the [startup diagnostic contract and catalog](../guides/startup-diagnostics.md) for stable code branching, safe resource context, cleanup and CLI JSON compatibility.

Business channels use the independent `@mininglamp-oss/octo-channel-gateway` package and only the public client.
