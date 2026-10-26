# Host SDK

[简体中文](README.zh.md) | [Packages](../README.md)

Composes Runtime components inside your own application: turns an Extra module plus JSON configuration into a service in the calling process, injects business functions, reports status, and coordinates bounded shutdown. It also carries the shared Home, identity, and endpoint conventions so hosts stop re-inventing them. Execution stays in Core and Kernel; a host may load no Extras at all.

## When to use it

- Your host loads optional Extras — channel gateway, WeCom, Web UI — and needs one lifecycle for them.
- You want the same endpoint and Home conventions the CLI uses.
- You do not need it to call an existing Kernel (`/executor-kernel` is enough) or to embed Core directly.

## Host an Extra

```ts
import { createExtraService, type ExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { GatewayDependencies } from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function withGateway(
  endpoint: string,
  config: JsonObject,
  dependencies: GatewayDependencies,
  runHost: (extra: ExtraService) => Promise<void>
): Promise<void> {
  const extra = createExtraService({ endpoint, module: gateway, config, dependencies });
  const errors: unknown[] = [];
  try {
    await extra.initialize();
    await runHost(extra);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      const cleanup = await extra.close();
      if (!cleanup.complete) errors.push(new Error("Extra cleanup remains incomplete"));
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Gateway host failed");
}
```

`GatewayDependencies` carries `loadContexts` and an optional `createSessionStore`. Other Extras define their own. These functions run in your process and are never serialized to JSON or sent to Kernel.

## What it does, and what it does not

| Includes                                                      | Leaves to others                              |
| ------------------------------------------------------------- | --------------------------------------------- |
| Extra module assembly, dependency injection, status, shutdown | Execution: that is Core's `AgentExecutor`     |
| Home, identity, and endpoint helpers                          | Starting a Kernel on an Extra's behalf        |
| Passing a live `KernelClient` into each Extra                 | Provider installation, login, or model policy |

Core and Kernel never depend on Host SDK.

## Lifecycle

- Construction performs no I/O. `initialize()` starts the plugin; `status()` reports the service and plugin state. A failed `initialize()` throws `ServiceInitializationError` with the original cause and its rollback `cleanup`.
- Each Extra gets its own `KernelClient`. `close()` stops new invocations, cancels the calls it owns, and waits for them plus plugin disposers inside a shared four-second monotonic budget — shortened if an earlier deadline is inherited.
- `onDispose` must wait for consumers, persistence, and delivery. An execution terminal alone does not prove that work is done.
- Until plugin cleanup finishes, bounded host-function calls are still allowed for final persistence or delivery; after that, new dependency calls are rejected and pending operations are awaited. A timeout cannot force-kill arbitrary host JavaScript.
- `complete: false` preserves the failed ownership and blocks replacing the same endpoint and name. Calling `close()` again returns the same result.
- Close the old Extra completely before changing its module, JSON configuration, or dependency function references. Data read by an unchanged function can change between turns without a reload.
- Extra shutdown does not stop the shared Kernel, other Extras, or host databases, and never exits the host process. SQLite stays entirely with the application.

## Import and distribution

Private workspace package for source and submodule hosts. Published consumers use `/host` (`createExtraService`, endpoint helpers, and Kernel's `createKernelService` re-export), `/extra` for authoring types, and the concrete `/extras/*` entries. Workspace Home and identity helpers such as `hostHomePaths`, `ensureHostHome`, and `ensureLocalRuntime` are not re-exported by `/host` today.

## Further reading

- [Exports](src/index.ts), [Extra service](src/extra-service.ts), [plugin contract](src/extras.ts), [Home helpers](src/home.ts), [identity](src/identity.ts), [endpoints](src/endpoint.ts).
- [Public host facade](../../public/host.ts), [Extra guide](../../docs/en/guides/extras.md), [module loading](../../docs/en/concepts/module-loading.md).
- [SDK quickstart](../../docs/en/getting-started/sdk.md), [Gateway configuration and storage](../../SDK_CHANNEL_GATEWAY_GUIDE.md) (Chinese).
