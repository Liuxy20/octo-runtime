# Executor Kernel

[简体中文](README.zh.md) | [Packages](../README.md)

Runs [Executor Core](../octo-runtime-executor-core/README.md) in a separate worker process and exposes it over local IPC. The host owns a Kernel service, business code talks to a `KernelClient`, and the worker is a small file you compile that registers the Adapters you ship. Reach for it when a Provider crash, OOM, or `process.exit` must not take down the app around it.

## When to use it

- Long-lived desktop or CLI host: execution is isolated, supervised, and restartable.
- Several callers — UI, Extras, automations — share one execution service.
- You need bounded stream replay after a dropped connection.

A short script that runs one prompt and exits is simpler with Core directly.

## Three pieces you will wire

| Piece            | Entry point                                                 | Responsibility                                                    |
| ---------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Business caller  | `attachKernel({ endpoint })`, or an injected `KernelClient` | Owns its connection and invocation policy                         |
| Composition root | `createKernelService(options)`, then `initialize()`         | Owns the service, closes it on shutdown, reads the cleanup result |
| Worker           | `serveWorker([...adapters])` in your own entrypoint         | Registers Adapters and serves execution through Core              |

The socket or pipe belongs to the calling process. Isolation comes from the worker, not from the service process.

## Make one call

`worker.mjs` — a file you own; Kernel only spawns it:

```js
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

serveWorker([dshAdapter]);
```

In the host process, construct the service. This does no I/O; nothing listens until `initialize()` resolves:

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

Then invoke and close:

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

`stateDirectory` is optional, but it is where orphan-cleanup records survive a restart.

## Calling from another process

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

The consumer has to answer interaction requests for the selected Provider. [attach.mts](../../docs/examples/attach.mts) shows connection ownership plus interaction replies; [service.mts](../../docs/examples/service.mts) shows owning the service and keeping execution and cleanup errors apart.

## Service lifecycle

Construction performs no I/O. After `initialize({ signal? })`, `kernel.client` is usable and `status()` reports phase, endpoint, pid, and worker state. `close()` stops admission and coordinates shutdown within the shared five-second budget, returning a `ServiceCleanupResult`; the `closed` promise resolves with the same value. A failed `initialize()` throws `ServiceInitializationError` carrying the original `cause` and whatever `cleanup` it managed.

Neither `closed` nor a stopped leader process proves cleanup finished — check `complete`. Close the Extras you own before the Kernel you own, and never let an Extra close a shared Kernel or somebody else's runs. Attaching a client does not make you the service owner.

## Cancellation and observation

| Operation                                                    | Meaning                                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `invoke(input, { signal })`                                  | Abort before dispatch: nothing is submitted. Abort after: asks to cancel that invocation and keeps observing its tail. |
| `cancelInvocation(invocationId)`                             | Cancel an invocation started through this client. `accepted` is not a terminal state.                                  |
| Iterator `return()`, ending a subscription, `client.close()` | Stop observing. Accepted execution keeps running and the service stays up.                                             |
| Extra or service `close()`                                   | Applies the owning service's explicit cancellation and cleanup policy.                                                 |

A client tracks at most 128 in-flight or unknown invocations. Service shutdown manages those for ordinary users; advanced attached callers can use `invocations.stopAdmission()` and `drain({ deadline, reason })`, which confirms execution state but not delivery or database completion.

Low-level `submit`, `get`, `subscribe`, `cancel`, `respond`, and `respondNative` remain available when you manage complete `RunRef` ownership yourself. They are not enrolled in the high-level registry automatically. See the [IPC reference](../../docs/en/reference/kernel-ipc.md).

## Recovery and limits

- Transport is one UTF-8, LF-terminated JSON-RPC 2.0 request per connection over a Unix socket or Windows named pipe. Worker execution uses stdio NDJSON; a separate Node IPC channel carries supervision heartbeats.
- A lost submission acknowledgement is repaired by querying the original identity, never by submitting again. Stream repair resumes from the original identity and last contiguous sequence; gaps, expiry, and instance changes fail explicitly.
- Worker failure first runs owned-process cleanup, then bounded rapid retries, then low-frequency recovery. Failed cleanup or ownership blocks replacement. A new worker accepts new runs and does not replay interrupted ones; active runs that lose their worker report `lost`, and an already retained terminal is preserved.
- Defaults: 4,096 frames or 32 MiB per Run, 128 MiB or 128 Runs globally, 120-second terminal retention. Kernel allows 64 connections and 16 subscriptions; a client allows 32 in-flight connections. These bound transport records — they are not durable history and say nothing about process RSS.
- POSIX endpoints rely on socket permissions; Windows uses its own named-pipe mechanism. Process-tree cleanup is platform-specific, and a dead leader is not proof that descendants exited. Inspect cleanup evidence instead of inferring it.

## Import and distribution

Private workspace package. Applications import `@mininglamp-oss/octo-runtime/executor-kernel` for `attachKernel`, `KernelClient`, and `serveWorker`. `@mininglamp-oss/octo-runtime/host` also re-exports `createKernelService` and the endpoint helpers; the implementation stays in this package. Kernel and Core do not depend on Host SDK.

## Further reading

- [Exports](src/index.ts), [service](src/service.ts), [client](src/client.ts), [worker entry](src/serve.ts), [source window](src/host-run-service.ts), [supervisor](src/supervisor.ts).
- [Core](../octo-runtime-executor-core/README.md), [Host SDK](../octo-runtime-host-sdk/README.md), [SDK onboarding](../../docs/en/getting-started/sdk.md), [module loading](../../docs/en/concepts/module-loading.md).
- [Client tests](../../test/kernel-clients.test.js), [worker supervision tests](../../test/kernel-worker-supervision.test.js), [source-window tests](../../test/host-run-service.test.js).
