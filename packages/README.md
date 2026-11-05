# Runtime Packages and Layers

[简体中文](README.zh.md) | [Developer documentation](../docs/en/README.md)

Octo Runtime is one Provider-neutral execution implementation shared by SDK applications, the bundled CLI, and optional business integrations. The host picks Adapters, configuration, and Extras. `AgentExecutor` in Executor Core performs the work; Executor Kernel owns local RPC, Run admission, observation, control, and bounded replay in the same host process; Host SDK composes optional Extras around it.

This directory holds the public client and private workspace packages. Each README explains its purpose, integration entry, and boundaries; execution examples live with Core and Kernel, while Adapter pages show registration and input preparation.

## Where to start

| You want to…                                 | Start with                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Connect to an existing Kernel without installing the full SDK | [Standalone Client](octo-runtime-client/README.md) |
| Embed Runtime in an Electron or Node application | [Executor Kernel](octo-runtime-executor-kernel/README.md)                                                                |
| Use explicit low-level execution primitives | [Executor Core](octo-runtime-executor-core/README.md)                                                            |
| Talk to a Provider CLI                       | the Provider table below                                                                                             |
| Write a new Adapter                          | [Adapter SDK](octo-runtime-adapter-sdk/README.md), then [ACP Adapter](octo-runtime-adapter-acp/README.md)            |
| Connect Octo IM or WeCom                     | [Channel Gateway](octo-runtime-extra-channel-gateway/README.md), [WeCom](octo-runtime-extra-channel-wecom/README.md) |
| Compose Extras into your app                 | [Host SDK](octo-runtime-host-sdk/README.md)                                                                          |
| Install a user-level background service      | [Cross-platform User Services](octo-runtime-cross-service/README.md)                                                 |

The typical path:

```text
Application or Extra
  -> KernelClient -> local IPC
  -> ExecutorKernel / HostRunService
  -> AgentExecutor in the Kernel host -> injected Adapter -> Provider
```

For native SDK integration, the host imports and constructs Adapters, passes them to `createKernelService({ home, endpoint, adapters })`, initializes the service, and uses `kernel.client`. Even in the same process, business calls use real local RPC. An Electron host can construct Kernel and optional Extras in its main process; the CLI deploys separate service hosts through the same factories. Bare Core is an explicit low-level API, not the ordinary in-process SDK entry point.

## Protocol

| Package                                                  | What it does                                                                      | Watch out for                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [octo-runtime-protocol](octo-runtime-protocol/README.md) | `InvokeInput`, Context v3, `CanonicalEvent`, `HostFrame`, JSON Schema, validators | It is the vocabulary, not an engine: it never calls a Provider or stores history |

## Adapter building blocks

| Package                                                        | What it does                                                                       | Watch out for                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [octo-runtime-adapter-sdk](octo-runtime-adapter-sdk/README.md) | `Adapter` interface, `defineAdapter`, subprocess, queue, approval, env/MCP helpers | You get a prepared `InvokeRequest`, not the public `InvokeInput` |
| [octo-runtime-acp-client](octo-runtime-acp-client/README.md)   | ACP JSON-RPC over NDJSON: correlation, update queues, permissions, cancel          | It does not produce `CanonicalEvent`; that is the Adapter's job  |
| [octo-runtime-adapter-acp](octo-runtime-adapter-acp/README.md) | Turns any ACP CLI into a full Adapter                                              | Canonical-only; `assisted` is rejected                           |

## Provider adapters

| Provider         | Package                                                                        | Transport                                 | Notes                                                                  |
| ---------------- | ------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------- |
| Codex            | [octo-runtime-adapter-codex](octo-runtime-adapter-codex/README.md)             | `codex app-server` JSON-RPC stdio         | native and canonical; approvals and questions route back to the caller |
| Claude Code      | [octo-runtime-adapter-claude-code](octo-runtime-adapter-claude-code/README.md) | `claude` stream-json stdio                | native and canonical; `can_use_tool` interactions                      |
| CodeBuddy        | [octo-runtime-adapter-codebuddy](octo-runtime-adapter-codebuddy/README.md)     | ACP stdio                                 | canonical; images and MCP unsupported                                  |
| OpenCode         | [octo-runtime-adapter-opencode](octo-runtime-adapter-opencode/README.md)       | JSON CLI for `full_access`, ACP for `ask` | canonical; requires `>=2.1.3 <3`                                       |
| DeepSeek Harness | [octo-runtime-adapter-dsh](octo-runtime-adapter-dsh/README.md)                 | official Client SDK over stdio            | canonical; `full_access` only; the one publicly exported Adapter       |
| OpenClaw         | [octo-runtime-adapter-openclaw](octo-runtime-adapter-openclaw/README.md)       | Gateway WebSocket RPC                     | canonical; calls an existing remote Agent                              |
| Grok Build       | [octo-runtime-adapter-grok-build](octo-runtime-adapter-grok-build/README.md)   | ACP stdio with native auth negotiation    | canonical; `>=1.0.67 <2`                                               |
| Antigravity      | [octo-runtime-adapter-antigravity](octo-runtime-adapter-antigravity/README.md) | `agy` stream-json stdio                   | canonical; `full_access` only                                          |
| Hermes           | [octo-runtime-adapter-hermes](octo-runtime-adapter-hermes/README.md)           | `hermes acp`                              | canonical; empty load result means missing session                     |
| Kimi Code        | [octo-runtime-adapter-kimi-code](octo-runtime-adapter-kimi-code/README.md)     | `kimi acp`                                | canonical; model from advertised `configOptions`                       |
| MCode            | [octo-runtime-adapter-mcode](octo-runtime-adapter-mcode/README.md)             | `mcode acp`                               | canonical; MiniMax owns model selection                                |
| Qoder CLI        | [octo-runtime-adapter-qodercli](octo-runtime-adapter-qodercli/README.md)       | `qodercli --acp`                          | canonical; `--yolo` only for `full_access`                             |
| Qoder CLI CN     | [octo-runtime-adapter-qoderclicn](octo-runtime-adapter-qoderclicn/README.md)   | `qoderclicn --acp`                        | canonical; separate binary and adapter type                            |

The host imports and constructs Adapter instances; Kernel registers those objects in its own process without serializing their methods or dependencies. CLI hosts own manifest resolution, dynamic imports, factories, and configuration loading. Kernel does not accept module manifests or start execution workers. Adapters may start Provider subprocesses and remain responsible for their cleanup. Each Adapter README lists its own Provider prerequisites and verification limits; being in this table is not evidence that a feature or platform passed real integration.

## Executor

| Package                                                                | What it does                                                                                       | Watch out for                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [octo-runtime-executor-core](octo-runtime-executor-core/README.md)     | The single `AgentExecutor`: input preparation, rendering, output validation, cancellation, cleanup | Shares the host's event loop and failure domain          |
| [octo-runtime-executor-kernel](octo-runtime-executor-kernel/README.md) | `createKernelService`, `KernelClient`, local JSON-RPC, Run admission/control, bounded replay          | Does not replay interrupted runs or own business history |

Kernel uses the single Core implementation in the host process. Kernel, Core, and injected Adapters share the host event loop, memory, and failure domain: RPC does not isolate synchronous blocking, `process.exit()`, OOM, or host crashes. Host restart belongs to the application or CLI; reconstruction creates a new Kernel instance and never re-executes previously accepted Runs. Reconnecting can only replay retained events from the original live instance; the bounded replay window is not durable history.

## Extras

| Package                                                                            | What it does                                                                    | Watch out for                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [octo-runtime-extra-channel-gateway](octo-runtime-extra-channel-gateway/README.md) | Octo IM bots: credentials, Wukong WebSocket, sessions, streaming replies, files | Needs an existing Kernel endpoint; never constructs or stops Kernel |
| [octo-runtime-extra-channel-wecom](octo-runtime-extra-channel-wecom/README.md)     | Independent WeCom bots with their own connection and lifecycle                  | The CLI `channel-gateway` service does not load it                  |
| [octo-runtime-extra-webui](octo-runtime-extra-webui/README.md)                     | Local browser workbench and its HTTP/SSE surface                                | A debugging UI, not a production application                        |

Extras own their business behavior and external connections. They receive execution through `ctx.kernel` and register cleanup through `ctx.onDispose`. The host decides which Extras to load — including none.

## Host composition and deployment

| Package                                                            | What it does                                                                                   | Watch out for                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [octo-runtime-host-sdk](octo-runtime-host-sdk/README.md)           | `createExtraService`, Extra lifecycle, host-function injection, Home/identity/endpoint helpers | Does not implement execution or start Kernel for an Extra        |
| [octo-runtime-cross-service](octo-runtime-cross-service/README.md) | launchd, systemd, and Windows Task Scheduler operations for user services                      | Installing a definition does not prove Provider or IPC readiness |

Host SDK depends on Kernel; Core and Kernel do not depend on Host SDK. Local execution needs no login and no cloud enrollment.

## Private packages and public entries

`@mininglamp-oss/octo-runtime-client` is published independently for existing-Kernel consumers. Other packages in this directory remain private workspace packages. Source and submodule hosts depend on them through the workspace. Full SDK consumers install `@mininglamp-oss/octo-runtime` and use its public subpaths. Both distributions bundle their own required client/protocol implementation; installing the full SDK does not require separately installing the standalone client.

The full SDK entries are:

| Source package                       | Public entry                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `octo-runtime-protocol`              | `/protocol`, plus `/protocol/schema.json`                                                                    |
| `octo-runtime-executor-core`         | `/executor-core`: `AgentExecutor`                                                                            |
| `octo-runtime-executor-kernel`       | `/executor-kernel`: `attachKernel`, `createKernelService`, `/executor-kernel/ipc-schema.json` |
| `octo-runtime-host-sdk`              | `/host`: `createExtraService`, `componentEndpoint`; `/extra`: plugin types                                   |
| `octo-runtime-adapter-dsh`           | `/adapters/dsh`: `dshAdapter`, `createDshAdapter`                                                            |
| `octo-runtime-extra-channel-gateway` | `/extras/channel-gateway`                                                                                    |
| `octo-runtime-extra-channel-wecom`   | `/extras/channel-wecom`                                                                                      |
| `octo-runtime-extra-webui`           | `/extras/webui`                                                                                              |

Not every workspace export is public. For example, the workspace Home and identity helpers are not re-exported by `/host` today, and no other Adapter has a public subpath. SDK module selection uses native imports and does not require a CLI manifest.

The host owns installation, configuration, credentials, per-turn Context, history, and storage. Acceptance, cancellation acknowledgement, execution completion, delivery, and resource cleanup remain distinct events.

## Next

- [SDK onboarding](../docs/en/getting-started/sdk.md), [architecture](../docs/en/concepts/architecture.md), [module loading](../docs/en/concepts/module-loading.md).
- [Kernel IPC reference](../docs/en/reference/kernel-ipc.md), [input reference](../docs/en/reference/invoke-input.md).
