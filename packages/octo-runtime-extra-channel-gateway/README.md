# Octo Gateway Channel

[简体中文](README.zh.md) | [Packages](../README.md)

The Extra that puts an Octo IM bot in front of a running Kernel: bot credentials, the Wukong WebSocket, message admission, per-conversation sessions, `ctx.kernel.invoke`, and streaming replies back to the chat. It owns Octo IM only — WeCom is a separate Extra with its own lifecycle.

## When to use it

- You want an Octo bot that runs on the same execution path as your app.
- You need private chat, groups and topics, interactive cards, or file delivery.
- You are connecting WeCom instead: use [WeCom Channel](../octo-runtime-extra-channel-wecom/README.md).

## Host it

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function startGateway(endpoint: string, config: JsonObject) {
  const extra = createExtraService({ endpoint, module: gateway, config, dependencies: {} });
  await extra.initialize();
  return extra;
}
```

`endpoint` is an existing Kernel endpoint; the Gateway never constructs or stops Kernel. Pass `dependencies.loadContexts` when you want per-turn business Context, and `dependencies.createSessionStore` when chat-to-session bindings must survive a restart.

## Configuration

```json
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "enabled": true,
  "config": {
    "bots": [
      {
        "api_url": "https://im-test.deepminer.com.cn/api",
        "bot_id": "<BOT_ID>",
        "bot_name": "local-assistant",
        "enabled": true,
        "bf_token": "<BOT_TOKEN>",
        "adapter": {
          "adapter_type": "codex",
          "workdir": "/absolute/workspace",
          "model": "gpt-6.1-sol",
          "effort": "medium"
        },
        "approval_mode": "full_access",
        "run_timeout_ms": 600000,
        "context": {
          "schema": "octo.context-envelope/v3",
          "items": [
            {
              "namespace": "octo.control",
              "name": "instructions",
              "payload": { "entries": [{ "text": "You are the local assistant." }] }
            }
          ]
        },
        "allowed_sender_ids": ["<USER_ID>"],
        "groups_enabled": true,
        "group_ids": ["<GROUP_ID>"],
        "artifact_delivery": {
          "mode": "channel",
          "allowed_roots": ["/absolute/workspace"],
          "allowed_mime_types": ["image/png", "application/pdf"]
        },
        "cards": true,
        "typing": true
      }
    ]
  }
}
```

This is the complete CLI declaration: `module`, `enabled`, and the plugin's own `config`. The SDK takes the inner object — `createExtraService({ endpoint, module, config: declaration.config, dependencies })` — and ignores `enabled`, which only decides whether the CLI service starts the plugin.

One bot is still `bots: [bot]`; there is no single-object form. Each `extraset` replaces the whole declaration — omitted fields are not carried over, and bots are not merged by `bot_id`. Limits: 64 bots, 64 in-flight management operations, 256 KiB per declaration.

## Bot fields you will actually set

| Field                         | Notes                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api_url`, `bot_id`           | Required. `api_url` points at Octo IM, for example `https://im-test.deepminer.com.cn/api`.                                                                         |
| `bf_token`                    | Bot token supplied by the host. The plugin never reads credential files or a config center.                                                                        |
| `adapter`                     | Required execution settings: `adapter_type`, `workdir`, `model`, and Provider-specific options.                                                                    |
| `context`                     | Optional Context v3 envelope; empty `items` is legal.                                                                                                              |
| `approval_mode`               | Defaults to `full_access`; the allowed range follows the selected Adapter.                                                                                         |
| `groups_enabled`, `group_ids` | Groups and topics. Omitting `groups_enabled` or setting `true` enables them; private chat is never affected.                                                       |
| `run_timeout_ms`              | Defaults to `86400000` (24 h); allowed range `100..86400000`.                                                                                                      |
| `allowed_sender_ids`          | Omitting it adds no restriction; `[]` denies everyone.                                                                                                             |
| `artifact_delivery`           | `mode: "tools"` disables the built-in upload; `allowed_roots`, `allowed_mime_types`, `max_file_bytes`, `max_total_bytes`, `max_files`, and `timeout_ms` narrow it. |
| `cards`, `typing`             | Booleans, both default `true`. Turning cards off keeps plain text replies working.                                                                                 |

Full field list, defaults, and limits: [config-schema.json](config-schema.json).

## Sessions and delivery

- Chat-to-session bindings live in an `ImSessionStore`. The default `MemoryImSessionStore` is bounded and does not survive a restart; provide `createSessionStore(botConfig)` to persist them. The store never holds full Provider history and cannot resume an unfinished Run.
- The plugin decides this turn's Context content and order. An empty Context is allowed; the host only validates, forwards, and renders it, and never backfills from chat history.
- Files referenced in a successful final are uploaded as IM attachments: 20 MiB per file, 50 MiB per turn, 16 distinct files, 30 seconds of preparation. Partial failures keep the successful links and name the files that were not delivered.
- A `session.update` from the Adapter is opaque Provider binding data, not application history.

## Lifecycle and status

`status()` returns `{ bots, errors }`: valid bots report connection, delivery, and session counts, while an invalid bot is reported by index and error code without blocking the others. `loaded` does not mean every bot is online.

`close()` cancels the connection, execution, and delivery work the plugin owns. Await it and check `complete` before replacing the Extra; it does not stop Kernel or other Extras. Cleanup failures surface as `EXTRA_DISPOSE_FAILED`.

## CLI deployment

Saved declarations live at `<home>/extras/channel-gateway/config.json` (POSIX `0600`). After editing one, run `octo-runtime channel-gateway restart` on a device with the background service installed, or `octo-runtime channel-gateway run` in the foreground. `octo-runtime status` reports the lifecycle, again not per-bot connectivity. Writing config does not install packages, connect immediately, or mutate a running instance.

## Import and distribution

Published entry: `@mininglamp-oss/octo-runtime/extras/channel-gateway`. The private workspace package name is for source and submodule hosts.

## Further reading

- [Implementation](src/index.ts), [dynamic Context guide](../../.octospec/guides/channel-dynamic-contexts.md), [channel contract](../../.octospec/rules/channel-integration.md).
- [Gateway guide](../../SDK_CHANNEL_GATEWAY_GUIDE.md), [Host SDK](../octo-runtime-host-sdk/README.md).
