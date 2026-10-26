# WebUI Extra

[简体中文](README.zh.md) | [Packages](../README.md)

A local browser workbench as the optional `webui` Extra. It serves the UI, calls an existing Kernel, and streams source events to the browser over SSE. It owns its HTTP listener, its bundled assets, and one explicitly configured session JSON file. It is a debugging surface, not a production application, and it never starts a second executor.

## When to use it

- You want to poke at a running Kernel from a browser on the same machine.
- You need a quick way to inspect sessions, adapters, directories, and streaming output.
- You are building the actual product: use the SDK, not this.

## Host it

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as webui from "@mininglamp-oss/octo-runtime/extras/webui";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function startWebUI(endpoint: string, config: JsonObject) {
  const extra = createExtraService({ endpoint, module: webui, config, dependencies: {} });
  await extra.initialize();
  return extra;
}
```

No React on the host side: the browser assets ship prebuilt in `dist/web`.

## Configuration

| Field                | Notes                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `port`               | Defaults to `13888`. The listener is fixed to `127.0.0.1`.                                                         |
| `sessionStorePath`   | Required and absolute. This is the one JSON file the Extra owns.                                                   |
| `defaultProjectPath` | Defaults to `~/octo-runtime-workspace`. Projects are real directories on the service machine, not browser uploads. |
| `context`            | Merged with each request's Context by namespace/name; request items replace the whole configured item.             |

The CLI wraps these fields as `{ "module": "@mininglamp-oss/octo-runtime-extra-webui", "enabled": true, "config": { ... } }`; the SDK passes only `config`. Full declaration: [config-schema.json](config-schema.json). Save the declaration with `octo-runtime extraset webui`, then run the independent `octo-runtime webui start` service. Apply configuration changes with `octo-runtime webui restart`.

## Sessions

The JSON file is `{ version: 1, sessions: [...] }`, capped at 100 sessions and 32 MiB, with least-recently-used eviction. Opaque Provider bindings are preserved; a UI session ID is not itself a Provider binding. Writes are atomic, POSIX `0600`, revision-serialized, and corruption-checked. Deleting a session removes the WebUI record and cancels its in-flight work, but never deletes project files, native Provider sessions, or Runtime identity. UI-only settings such as project selection, drafts, and model IDs live in browser `sessionStorage`.

## HTTP boundary

- Page cookie plus Host validation, and same-origin/token checks on writes; no CORS.
- At most four active invocations, one per session.
- SSE applies pipeline backpressure; a disconnect or page unload forwards cancellation.
- Routes cover bootstrap, adapters, directories, sessions, invoke, cancel, and respond.
- An SSE EOF without a terminal means disconnected, not complete, and does not resend the model request automatically.

## Status

`status()` returns `{ listening, host, port, activeRequests, errors }`. `loaded` alone does not prove the listener bound successfully, and port or config failures stay visible. Stopping WebUI leaves Kernel and other Extras running.

## Verification

Build the package, run its `test:ui`, then `node --test test/webui-extra.test.js`. Fake-Provider UI checks are not evidence about a real Provider.

## Import and distribution

Published entry: `@mininglamp-oss/octo-runtime/extras/webui`.

## Further reading

- [Implementation](src/index.ts), [porting map](porting-map.md), [UI tests](web/test), [Host SDK](../octo-runtime-host-sdk/README.md).
