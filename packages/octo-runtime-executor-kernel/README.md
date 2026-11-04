# Executor Kernel

[简体中文](README.zh.md) | [Package index](../README.md)

The host must select and prepare an existing absolute `home`, then pass it explicitly to the service. SDK does not create the root or choose platform defaults. See [Runtime Home](../../docs/en/reference/runtime-home.md).

Kernel is the shared execution entry for Electron SDK hosts and CLI. It owns AgentExecutor, injected Adapters, a local RPC endpoint, and a bounded Run event source in the host process. Same-process business code still calls through KernelClient/RPC.

## Native Composition

The host imports and constructs Adapters, then supplies a local `endpoint` and `adapters`. The endpoint is a Unix socket / Named Pipe address; Home is a host-owned directory. `componentEndpoint(home)` derives the address. Module manifests, resolution, dynamic imports, and factories belong entirely to hosts such as CLI.

```ts
import { createKernelService } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { componentEndpoint } from "@mininglamp-oss/octo-runtime/host";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

import { mkdir } from "node:fs/promises";

// 宿主拥有目录选择和根准备。
const home = "/absolute/app-runtime-home";
await mkdir(home, { recursive: true });
const kernel = createKernelService({
  home,
  endpoint: componentEndpoint(home),
  adapters: [dshAdapter],
  adapterConfigurations: { dsh: { providerOptions: { dshBin: "/absolute/dsh/lib/bin.js" } } }
});
await kernel.initialize();
// 使用 kernel.client.invoke，消费到终态；退出先排空 Extra 和业务尾流，再关闭服务。
const cleanup = await kernel.close();
if (!cleanup.complete) throw new Error("KERNEL_CLEANUP_INCOMPLETE");
```

Construction performs no I/O. The selection array is copied while Adapter identity, prototype, methods, closures, and host dependencies remain intact. Initialization validates protocol declarations and duplicate types. Empty selection registers nothing; do not mutate registered metadata. Kernel does not freeze or dispose arbitrary host dependencies.

## Responsibilities

| Case | Host owns | Kernel owns |
| --- | --- | --- |
| Electron | Main-process imports/factories, endpoint, Extras, exit coordination | Registration, RPC, admission, execution lifecycle |
| CLI | Manifest reading/merging, module resolution/imports/factories, OpenClaw preparation | The same service factory using actual objects |
| Independent cross-process application (including CLI clients) | attachKernel, its client, and its own Runs; native SDK hosts use kernel.client | Shared service and original execution |
| Provider subprocess | Adapter native launch/control/cleanup | Core invocation and truthful cleanup reporting |

Kernel accepts no workerEntrypoint, adapterModules, manifest, or subprocess env. It launches no execution workers and provides no worker heartbeat/restart. Status contains ipc_version, kernel_instance_id, host pid, and execution_ready without worker state. Configure logs explicitly with logging.directory; SDK does not read CLI log environment variables.

## Execution, Observation, and Cancellation

The standard path is `KernelClient -> local RPC -> Kernel/HostRunService -> AgentExecutor -> Adapter`. Adapter objects remain in the service process; RPC carries invocation, control, and event data. Direct Core does not replace standard SDK integration.

- invoke submits when consumption starts; ACK confirms admission only.
- Abort before submission prevents it; abort after submission requests cancellation and continues observing the tail.
- iterator.return, subscription disconnect, and client.close only stop observation; admitted execution continues.
- get/subscribe use the original identity and cursor. A lost ACK triggers lookup, never repeat invocation.
- respond/respondNative target valid interactions of the original Run. Cancellation ACK is not a terminal outcome.

## Lifecycle and Failure Boundaries

Await initialize before accessing client. close is idempotent; closed resolves to the same cleanup result. Close owned Extras and drain business delivery/storage before Kernel. Attached clients do not own the service.

Shutdown stops admission and closes connections, then cancels Core, awaits Adapter cleanup, and releases Run/log/endpoint resources under one five-second deadline. An Adapter next rejection may originate in finally, so it cannot prove cleanup. complete=false retains failure and endpoint ownership evidence. stateDirectory selects the recovery-record directory; POSIX defaults to endpoint + .runs. Windows needs an explicit directory to retain this record.

The ownership record is not a module manifest. After abnormal host exit, nativeOwner/cleanupIncomplete evidence is retained rather than treating the host PID as a child to kill. Operators stop remaining resources and use the existing orphan-cleanup acknowledgement flow. Legacy worker formats and malformed records fail with ORPHAN_RECORD_UNSUPPORTED and remain untouched. No legacy compatibility, upgrade, or automatic cleanup is provided.

Kernel and Adapters share the host event loop, memory, and failure domain. RPC does not isolate blocking code, process.exit, or OOM; deadlines require a schedulable event loop. Reconstruction creates a new kernel_instance_id and never replays old Runs. Adapters remain responsible for Provider subprocess cleanup.

Default windows retain 4096 frames / 32 MiB per Run, 128 MiB / 128 Runs globally, for 120 seconds, with at most 64 connections and 16 subscriptions. These are bounded replay records, not durable history or RSS limits. Run deadlines default to 24 hours and allow up to seven days.

## Further Reading

[SDK example](../../docs/en/getting-started/sdk.md), [IPC](../../docs/en/reference/kernel-ipc.md), [service](src/service.ts), [RPC server](src/server.ts), [Run source](src/host-run-service.ts), [native composition tests](../../test/adapter-composition.test.js), [shutdown tests](../../test/host-process-close.test.js).
