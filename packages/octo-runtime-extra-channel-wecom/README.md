# WeCom Channel

[简体中文](README.zh.md) | [Packages](../README.md)

The optional `channel-wecom` Extra: connects WeCom bots over their own WebSocket, admits messages, builds this turn's input, calls the existing Kernel through `ctx.kernel`, and replies with WeCom streaming messages. Authentication, heartbeat, ACK order, and delivery stay here — independent of Core, and independent of the Octo Gateway implementation.

## When to use it

- You need WeCom rather than Octo IM; neither channel depends on the other.
- Your SDK host owns the Extra lifecycle and Kernel endpoint.
- You want CLI deployment: save a `channel-wecom` declaration, then use `octo-runtime channel-wecom start`; its service is independent of `channel-gateway`.

## Common CLI commands

Replace the placeholders, configure the Extra, then start its independent service as needed:

```sh
octo-runtime channel-wecom configure \
  --bot_id assistant \
  --ws_url wss://openws.work.weixin.qq.com \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "<APP_SECRET>"
```

Each call configures one Bot. Repeat it to update an existing `bot_id`, including its endpoint, or append a new ID to `config.bots`. Omitted fields and other Bots are preserved. Legacy entries sharing an ID across endpoints collapse into the first matching entry, preserving its omitted fields. Business option names match configuration fields; credentials are passed directly as strings.

Optional options: `--model` and `--effort` (low/medium/high/xhigh). For OpenClaw use `--adapter_type openclaw` and `--provider_agent_id main`, without `--workdir`; when switching an existing local adapter, remove its old workdir through `config set`. `--ws_url` is optional: updates preserve the existing endpoint; new Bots use the official default.

```sh
octo-runtime channel-wecom start
octo-runtime channel-wecom status
octo-runtime channel-wecom restart
octo-runtime channel-wecom stop
octo-runtime channel-wecom configure \
  --help
```

Configuration only saves the file; it does not start or reload services. Use `start` for first use and `restart` after changing a running service. Agent execution also requires a separately started `executor-kernel`.

## Host it

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as wecom from "@mininglamp-oss/octo-runtime/extras/channel-wecom";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function startWeCom(endpoint: string, config: JsonObject) {
  const extra = createExtraService({ endpoint, module: wecom, config, dependencies: {} });
  await extra.initialize();
  return extra;
}
```

Stable Extra name: `channel-wecom`.

## Advanced: JSON configuration and SDK fields

Advanced usage: use `config set/get` for manually written business JSON without an envelope, or `extraset/extraget` for a complete declaration containing `config` and optional `module`/`enabled`.

```sh
octo-runtime channel-wecom config set \
  < channel-wecom-business.json
octo-runtime channel-wecom config get

octo-runtime extraset channel-wecom \
  < channel-wecom-declaration.json
octo-runtime extraget channel-wecom
```

`config set` validates and replaces all business configuration while preserving host fields. `extraset` replaces the entire declaration without merging by bot_id or preserving omitted fields. Read commands return their complete JSON, including channel credentials. Restart a running Extra after saving.

```json
{
  "bots": [
    {
      "bot_id": "<BOT_ID>",
      "app_secret": "<APP_SECRET>",
      "adapter": { "adapter_type": "dsh", "workdir": "/absolute/workspace" },
      "allowed_sender_ids": ["<USER_ID>"]
    }
  ]
}
```

| Field                  | Notes                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bots`                 | Up to 16. Each needs `bot_id`, an `adapter`, and a resolved `app_secret` before it can connect.                                |
| `ws_url`               | Defaults to `wss://openws.work.weixin.qq.com`.                                                                                 |
| `adapter`              | Local engines need an absolute `workdir`. OpenClaw forbids `workdir` and uses an existing `provider_agent_id`, default `main`. |
| `approval_mode`        | Defaults to `full_access`.                                                                                                     |
| `run_timeout_ms`       | Defaults to `120000`, allowed range `1..600000`.                                                                               |
| `allowed_sender_ids`   | Omitting it adds no sender restriction; `[]` denies everyone.                                                                  |
| `authorized_space_ids` | Validated for shape only. It does not enforce Octo Space admission on WeCom messages — use WeCom's own sender policy.          |

This block is the inner `config`. The CLI declaration wraps it as `{ "module": "@mininglamp-oss/octo-runtime-extra-channel-wecom", "enabled": true, "config": { ... } }`; the SDK passes only `config`.

Full field list and limits: [config-schema.json](config-schema.json).

## Context

Optional `loadContexts(botConfig, { signal })` replaces same-key static Context items once per admitted turn. Defaults are 5000 ms and 8 real pending calls, bounded to `1..30000` and `1..32`. A failure prevents the invocation; a timed-out call holds capacity until it settles. Omitting Context does not add a persona.

## Status, sessions, shutdown

`status()` returns `{ bots, errors }`; a bad bot is reported by index and code while the valid ones still initialize. Sessions and receipt deduplication are bounded in memory, not durable restart recovery, and delivery counts describe retained receipts rather than cumulative sends. Real client rendering has to be verified on WeCom itself.

Await `close()` and require `complete` before replacing the Extra. Disposal cancels connection, execution, and delivery work; observed failures surface as `EXTRA_DISPOSE_FAILED`. It never stops Kernel or other Extras.

## Import and distribution

Published entry: `@mininglamp-oss/octo-runtime/extras/channel-wecom`.

## Further reading

- [Implementation](src/index.ts), [Host SDK](../octo-runtime-host-sdk/README.md), [Octo Gateway](../octo-runtime-extra-channel-gateway/README.md).
- [Channel contract](../../.octospec/rules/channel-integration.md).
