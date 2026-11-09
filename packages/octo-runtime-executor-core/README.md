# Executor Core

[简体中文](README.zh.md) | [Packages](../README.md)

`AgentExecutor` is the one place Octo Runtime actually runs an agent. Register the Adapters you ship, hand it an `InvokeInput`, and it prepares the turn, calls the selected Provider, and streams the result back. Kernel uses this class in its host process. Standard Electron/CLI integration uses KernelClient/RPC; the examples below explain the low-level execution API.

## When to use it

- You run execution inside your own process and accept sharing its event loop, memory, and failure domain.
- Standard host integration uses [Kernel](../octo-runtime-executor-kernel/README.md) for RPC, Run admission, and observation management.
- Kernel provides bounded replay and control; it does not isolate the host failure domain.

## Make one call

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime-executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime-protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime-adapter-dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter); // metadata.type is "dsh"; a duplicate type throws

const input = InvokeInput.check({
  inputs: [{ type: "text", text: "Summarize the last commit." }],
  agentEnv: {
    schema: "octo.context-envelope/v3",
    items: [
      {
        namespace: "octo.execution",
        name: "workspace",
        payload: { path: "/absolute/prepared/project" }
      },
      { namespace: "octo.security", name: "approval_policy", payload: { mode: "full_access" } },
      { namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }
    ]
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

The application prepares `/absolute/prepared/project` before calling. Local execution requires an explicit existing absolute directory through a path-only workspace item. Core does not inherit cwd, create application directories, allocate random workspaces or restore a missing directory during resume/fresh recovery. Workspace-owning external/preset Agents and `metadata.workspace: false` Adapters may omit the override. Missing/invalid paths produce stable `WORKDIR_*` reasons classified as `OH-ADP-3004`; see [input validation](../../docs/en/reference/invoke-input.md). `prepareRunContext` and `WorkspaceAssignments` are removed; Runtime operational state is separate.

Core validates and snapshots this invocation's input and AgentEnv, reads only the Adapter route, and forwards the caller's prepared text/images and configuration items in order. The Adapter owns configuration semantics, defaults, environment merging and native Provider mapping. Core creates no agentConfig or other configuration projection, renders no business Context and fills no gaps from session history. Identity, capacity and closed-state checks run during admission, before the Provider starts.

`invokeFrames` validates synchronously, so a malformed request throws at the call. `invoke` is an async generator, so everything runs at the first `next()`. Wrap the whole consumption loop, not just one call: an unconsumed iterator reserves no capacity and starts no Provider.

`environment` is the second argument and never travels in the JSON:

- `signal` — cancellation for this run.
- `executionEnvOverrides` — trusted values the host injects.
- `providerOptions` — trusted host connection settings bound locally for Adapter consumption, without writing them back into AgentEnv.
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

The overall deadline defaults to 24 hours and accepts up to seven days. For 72 hours, pass Context `octo.execution/limits` with `run_timeout_ms: 259200000`. First-frame, model-idle and tool-idle detection remain independent. See [input precedence and ranges](../../docs/en/reference/invoke-input.md).

In canonical mode only `run.completed` is success. A final message, an accepted cancellation, and an iterator that simply runs out are not.

Closing a direct iterator early _requests cancellation_ — unlike Kernel, where stopping observation leaves the run alive. An iterator nobody closes or cancels does not cancel itself: the run keeps going and holds capacity until it ends or the owner shuts down.

## Cleanup

`shutdown()` returns an immutable snapshot. `state: "closed"` only means no new runs are accepted; only `cleanup: "complete"` means every owned resource was actually released. When it is `incomplete`, `unresolvedInvocationIds` and `failedCleanupInvocationIds` name what is still holding on.

Each registered Adapter may create an independent execution scope. Core binds invocation and interaction methods to that scope, stops scope admission during shutdown, then awaits local invocation/lease cleanup. Explicit host owners manage persistent Engine recovery and shutdown; Core does not close injected shared Engines. `unresolvedServiceIds` and `failedCleanupServiceIds` report service ownership separately, including when no invocation remains. `processes()` returns validated resident-service snapshots without starting a Provider or probe. Codex keeps healthy services alive between turns; only the owner closes them.

Admission never reopens and a failed finalizer is never retried — a later `shutdown()` waits again but cannot resurrect the attempt. A rejected `next()`, a `return()` that reports `done: false`, or a generator without a usable finalizer is not proof of disposal.

Provider terminal draining and iterator closure share one monotonic `cancelGraceMs` budget, starting at the first terminal, abort, or cleanup request; the `shutdown` timeout bounds only that caller's wait.

Core keeps at most 1,024 invocation identity records and evicts inactive ones after 120 seconds. Active, paused, and uncleaned invocations are never evicted, so leaked ownership eventually exhausts capacity. These records are correlation state, not history and not an output replay buffer.

`shutdown()` also waits for actual Adapter probes it has started. A `describe()` display timeout does not end a probe. Pending probes produce `cleanup: "incomplete"`, potentially with empty invocation identity lists. Closing prevents new probes; settlement releases their tracking records.

## Direct Core or Kernel

| Concern                    | Direct `AgentExecutor`                                                                     | `KernelClient`                             |
| -------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Execution location         | Your process                                                                               | Kernel host process                        |
| Failure domain             | Shares your event loop; `process.exit`, OOM, or a synchronous block takes the host with it | Shares the Kernel host failure domain      |
| Ending the iterator early  | Requests cancellation                                                                      | Stops observation only                     |
| Replay                     | None                                                                                       | Bounded, by original identity and sequence |
| `environment.streamLimits` | Supported                                                                                  | Rejected                                   |
| Shutdown                   | `shutdown()`, then check `cleanup`                                                         | `close()`, then check `complete`           |

Electron, Node SDK hosts, and CLI hosts use KernelClient over local RPC. Direct Core is the lower-level execution implementation for internal integration and tests; it does not provide Kernel admission, observation, or replay. Neither path needs an business consumer.

## Import and distribution

Private workspace package: native hosts integrate `@mininglamp-oss/octo-runtime-executor-core` from source and depend only on selected Adapters, without installing the CLI package and all bundled Adapters. Independent applications use `octo-runtime-client` to connect to an existing Kernel.

## Further reading

- [Implementation and exports](src/index.ts), [input preparation](src/invoke-input.ts), [watchdog](src/watchdog.ts).
- [Kernel](../octo-runtime-executor-kernel/README.md), [input reference](../../docs/en/reference/invoke-input.md), [output and control](../../docs/en/reference/output-and-control.md).
- [Executor tests](../../test/executor-core.test.js), [cleanup budget tests](../../test/executor-cleanup-budget.test.js).
