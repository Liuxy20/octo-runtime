# Executor Core

[简体中文](README.zh.md) | [Packages](../README.md)

`AgentExecutor` is the one place Octo Runtime actually runs an agent. Register the Adapters you ship, hand it an `InvokeInput`, and it prepares the turn, calls the selected Provider, and streams the result back. Kernel runs this same class inside its isolated worker, so in-process embedding and the Kernel path cannot drift into two different execution behaviours.

## When to use it

- You run execution inside your own process and accept sharing its event loop, memory, and failure domain.
- You are writing a Kernel worker entrypoint — `serveWorker` builds an `AgentExecutor` for you.
- You need process isolation, supervision, or stream replay: use [Kernel](../octo-runtime-executor-kernel/README.md) instead.

## Make one call

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

Two details that trip people up: the Adapter is chosen by the `octo.execution` / `adapter` Context item, not by a constructor option; and asking for `canonical` gives you `CanonicalEvent` instead of Provider frames.

## What the executor does with your input

It validates and freezes the request, renders this turn's model input, resolves the local environment, and admits the run. Admission happens before any Provider starts: identity, capacity, and closed-state checks all run there. Business Context comes from this invocation only — Core never fills a gap from session history.

`invokeFrames` validates synchronously, so a malformed request throws at the call. `invoke` is an async generator, so everything runs at the first `next()`. Wrap the whole consumption loop, not just one call: an unconsumed iterator reserves no capacity and starts no Provider.

`environment` is the second argument and never travels in the JSON:

- `signal` — cancellation for this run.
- `executionEnvOverrides` — trusted values the host injects.
- `streamLimits` — local budgets; Kernel rejects this one (`KERNEL_STREAM_LIMITS_UNSUPPORTED`).

## API

| Call                                  | What it does                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `register(adapter)`                   | Register by `metadata.type`. A second registration of the same type throws.                                                                     |
| `list()`, `describe(configurations?)` | List registered Adapters; `describe` probes installation and adds `available` plus a reason. Available is not a promise that this run succeeds. |
| `invoke(input, environment?)`         | The normal entry. `native` frames by default, `CanonicalEvent` with `protocol_mode: "canonical"`.                                               |
| `invokeFrames(input, environment?)`   | The same execution with the `HostFrame` envelope (run ID, invocation ID, `seq`) kept around each event.                                         |
| `cancel(invocationId)`                | Request cancellation. `true` means accepted, not that the Provider exited.                                                                      |
| `respondInteraction`, `respondNative` | Answer an interaction request for the invocation that owns it.                                                                                  |
| `shutdown(reason?, timeoutMs = 2500)` | Stop accepting work and wait, bounded, for cleanup.                                                                                             |

## What ends a run

In canonical mode only `run.completed` is success. A final message, an accepted cancellation, and an iterator that simply runs out are not.

Closing a direct iterator early _requests cancellation_ — unlike Kernel, where stopping observation leaves the run alive. An iterator nobody closes or cancels does not cancel itself: the run keeps going and holds capacity until it ends or the owner shuts down.

## Cleanup

`shutdown()` returns an immutable snapshot. `state: "closed"` only means no new runs are accepted; only `cleanup: "complete"` means every owned resource was actually released. When it is `incomplete`, `unresolvedInvocationIds` and `failedCleanupInvocationIds` name what is still holding on.

Admission never reopens and a failed finalizer is never retried — a later `shutdown()` waits again but cannot resurrect the attempt. A rejected `next()`, a `return()` that reports `done: false`, or a generator without a usable finalizer is not proof of disposal.

Provider terminal draining and iterator closure share one monotonic `cancelGraceMs` budget, starting at the first terminal, abort, or cleanup request; the `shutdown` timeout bounds only that caller's wait.

Core keeps at most 1,024 invocation identity records and evicts inactive ones after 120 seconds. Active, paused, and uncleaned invocations are never evicted, so leaked ownership eventually exhausts capacity. These records are correlation state, not history and not an output replay buffer.

## Direct Core or Kernel

| Concern                    | Direct `AgentExecutor`                                                                     | `KernelClient`                                      |
| -------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Execution location         | Your process                                                                               | Kernel's isolated worker                            |
| Failure domain             | Shares your event loop; `process.exit`, OOM, or a synchronous block takes the host with it | Worker failures are contained; the service stays up |
| Ending the iterator early  | Requests cancellation                                                                      | Stops observation only                              |
| Replay                     | None                                                                                       | Bounded, by original identity and sequence          |
| `environment.streamLimits` | Supported                                                                                  | Rejected                                            |
| Shutdown                   | `shutdown()`, then check `cleanup`                                                         | `close()`, then check `complete`                    |

Kernel is the recommended path for long-lived desktop hosts. Choose direct Core deliberately, when you accept the shared failure domain and own the executor's lifetime yourself. Neither path needs an Extra.

## Import and distribution

Private workspace package: source and submodule hosts import `@mininglamp-oss/octo-runtime-executor-core`. Published consumers use `@mininglamp-oss/octo-runtime/executor-core`.

## Further reading

- [Implementation and exports](src/index.ts), [input preparation](src/invoke-input.ts), [current-turn rendering](src/model-input.ts), [watchdog](src/watchdog.ts).
- [Kernel](../octo-runtime-executor-kernel/README.md), [input reference](../../docs/en/reference/invoke-input.md), [output and control](../../docs/en/reference/output-and-control.md).
- [Executor tests](../../test/executor-core.test.js), [cleanup budget tests](../../test/executor-cleanup-budget.test.js).
