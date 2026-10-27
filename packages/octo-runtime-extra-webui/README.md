# WebUI Extra

[简体中文](README.zh.md) | [Packages](../README.md)

A local browser workbench as the optional `webui` Extra. It serves the UI, calls an existing Kernel, and streams source events to the browser over SSE. It owns its HTTP listener, its bundled assets, and one explicitly configured session JSON file. It is a debugging surface, not a production application, and it never starts a second executor.

## When to use it

- You want to poke at a running Kernel from a browser on the same machine.
- You need a quick way to inspect sessions, adapters, directories, and streaming output.
- You are building the actual product: use the SDK, not this.

## Common CLI commands

Replace the placeholders, configure the Extra, then start its independent service as needed:

```sh
octo-runtime webui configure \
  --port 13888
```

`configure` accepts only `--port`. The initial session file is `<home>/extras/webui/sessions.json`; existing paths and project settings are preserved. There is one WebUI configuration per Home. Custom paths use the advanced JSON interface below, with the existing `sessionStorePath` and `defaultProjectPath` fields.

```sh
octo-runtime webui start
octo-runtime webui status
octo-runtime webui restart
octo-runtime webui stop
octo-runtime webui configure \
  --help
```

Configuration only saves the file; it does not start or reload services. Use `start` for first use and `restart` after changing a running service. Agent execution also requires a separately started `executor-kernel`.

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

## Advanced: JSON configuration and SDK fields

Advanced usage: use `config set/get` for manually written business JSON without an envelope, or `extraset/extraget` for a complete declaration containing `config` and optional `module`/`enabled`.

```sh
octo-runtime webui config set \
  < webui-business.json
octo-runtime webui config get

octo-runtime extraset webui \
  < webui-declaration.json
octo-runtime extraget webui
```

`config set` validates and replaces all business configuration while preserving host fields. `extraset` replaces the entire declaration without preserving omitted fields. Read commands return their complete JSON. Restart a running Extra after saving.

| Field                | Notes                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `port`               | Defaults to `13888`. The listener is fixed to `127.0.0.1`.                                                         |
| `sessionStorePath`   | Required and absolute in SDK/manual JSON; CLI configure derives it on first use.                                                   |
| `defaultProjectPath` | Defaults to `~/octo-runtime-workspace`. Projects are real directories on the service machine, not browser uploads. |
| `context`            | Merged with each request's Context by namespace/name; request items replace the whole configured item.             |

The CLI wraps these fields as `{ "module": "@mininglamp-oss/octo-runtime-extra-webui", "enabled": true, "config": { ... } }`; the SDK passes only `config`. Full declaration: [config-schema.json](config-schema.json). Normally use `configure` above to construct the declaration; use `extraset` when managing JSON manually.

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
