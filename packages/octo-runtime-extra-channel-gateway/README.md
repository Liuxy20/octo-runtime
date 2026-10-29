# Octo Gateway Channel

[简体中文](README.zh.md) | [Packages](../README.md)

The Extra that connects an Octo IM bot to local Agent execution: bot credentials, the Wukong WebSocket, message admission, per-conversation sessions, `ctx.kernel.invoke`, and streaming replies back to the chat. Gateway and Executor Kernel start independently. Gateway stays running while Kernel is unavailable and waits for recovery; Agent execution requires a reachable Kernel. WeCom uses a separate Extra.

## When to use it

- You want an Octo bot that runs on the same execution path as your app.
- You need private chat, groups and topics, interactive cards, or file delivery.
- You are connecting WeCom instead: use [WeCom Channel](../octo-runtime-extra-channel-wecom/README.md).

## Common CLI commands

Inspect the commands and examples provided by the installed version:

```sh
octo-runtime channel-gateway --help
octo-runtime channel-gateway configure --help
```

Replace the placeholders, configure the Extra, then start its independent service as needed:

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "<BOT_TOKEN>"
```

Each call configures one Bot. Repeat it to update an existing `bot_id`, including its endpoint, or append a new ID to `config.bots`. Omitted fields and other Bots are preserved. Legacy entries sharing an ID across endpoints collapse into the first matching entry, preserving its omitted fields. Business option names match configuration fields; credentials are passed directly as strings.

On first configuration, omit `--model` and `--effort` to use the selected Harness framework's own defaults. Effort accepts low/medium/high/xhigh, subject to Harness support. Updates preserve existing values when these options are omitted; to restore defaults, remove the fields from the full declaration and save it with `extraset`. For OpenClaw use `--adapter_type openclaw` and `--provider_agent_id main`, without `--workdir`; when switching an existing local adapter, also remove its old workdir through `extraset`.

```sh
octo-runtime channel-gateway start
octo-runtime channel-gateway status
octo-runtime channel-gateway restart
octo-runtime channel-gateway stop
octo-runtime channel-gateway logs --lines 200
```

Configuration only saves the file; it does not start or reload services. Use `start` for first use and `restart` after changing a running service. Agent execution also requires a separately started `executor-kernel`.

Help lists shared commands before extension-owned commands:

| Command     | Purpose                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `install`   | Register this service with autostart enabled by default; use `--autostart=false` to disable it. |
| `uninstall` | Remove the service, preserving configuration and data.                                          |
| `start`     | Install if needed, then start and wait for readiness.                                           |
| `stop`      | Stop this service, preserving its autostart setting.                                            |
| `restart`   | Restart an installed service and wait for readiness; does not install it.                       |
| `run`       | Run in the foreground without registering a system service.                                     |
| `status`    | Inspect service state and Gateway's public business status.                                     |
| `logs`      | Read component status logs; supports `--follow`.                                                |
| `extraset`  | Read and replace the complete JSON declaration from stdin.                                      |
| `extraget`  | Print the complete JSON declaration, including credentials.                                     |
| `configure` | Gateway-owned command to add or update one Bot by `bot_id`.                                     |

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

## Advanced: JSON configuration and SDK fields

Advanced usage: use the Extra’s `extraset/extraget` subcommands for a complete JSON declaration containing `config` and optional `module`/`enabled`. Business commands are defined by each Extra; built-in Extras no longer provide `config set/get`.

```sh
octo-runtime channel-gateway extraset \
  < channel-gateway-declaration.json
octo-runtime channel-gateway extraget
```

`extraset` replaces the entire declaration without merging by bot_id or preserving omitted fields. Read commands return their complete JSON, including channel credentials. Restart a running Extra after saving.

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
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "approval_mode": "full_access",
        "run_timeout_ms": 86400000,
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

Both `model` and `effort` are optional. When omitted, the selected Harness uses its own defaults. Replace `<MODEL_ID>` with a model identifier supported by that Harness; `effort` accepts `low`, `medium`, `high`, or `xhigh`, subject to Harness support.

This is the complete CLI declaration: required `config` and optional `module`/`enabled`. The effective module manifest normally provides `module`; an explicit value must match the selected module. The SDK receives only the business configuration: `createExtraService({ endpoint, module: gateway, config: declaration.config, dependencies })`. The CLI handles top-level `enabled`, while Gateway handles each Bot's `enabled`; they belong to different configuration levels.

One bot is still `bots: [bot]`; there is no single-object form. Each `extraset` replaces the whole declaration — omitted fields are not carried over, and bots are not merged by `bot_id`. Limits: 64 bots, 64 in-flight management operations, 256 KiB per declaration.

## Bot fields you will actually set

| Field                         | Notes                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api_url`, `bot_id`           | Required. `api_url` points at Octo IM, for example `https://im-test.deepminer.com.cn/api`.                                                                         |
| `bf_token`                    | Bot token supplied by the host. The plugin never reads credential files or a config center.                                                                        |
| `adapter`                     | Execution settings: `adapter_type`, `workdir`, and Provider-specific options. `model` and `effort` are optional Harness overrides.                                 |
| `context`                     | Optional Context v3 envelope; empty `items` is legal.                                                                                                              |
| `stable_context_refresh_interval_turns` | Positive safe integer, default `30`. Refresh Gateway rules on turn 1 and turns N, 2N, etc.; reset/new restarts counting. |
| `approval_mode`               | Defaults to `full_access`; the allowed range follows the selected Adapter.                                                                                         |
| `groups_enabled`, `group_ids` | Groups and topics. Omitting `groups_enabled` or setting `true` enables them; private chat is never affected.                                                       |
| `run_timeout_ms`              | Defaults to `86400000` (24 h); allowed range `100..86400000`.                                                                                                      |
| `allowed_sender_ids`          | Omitting it adds no restriction; `[]` denies everyone.                                                                                                             |
| `artifact_delivery`           | `mode: "tools"` disables the built-in upload; `allowed_roots`, `allowed_mime_types`, `max_file_bytes`, `max_total_bytes`, `max_files`, and `timeout_ms` narrow it. |
| `cards`, `typing`             | Booleans, both default `true`. Turning cards off keeps plain text replies working.                                                                                 |

Full field list, defaults, and limits: [config-schema.json](config-schema.json).

Gateway supplies stable `extra.im/mention-instructions`, `artifact-delivery`, and `history-instructions` on the first task of a logical session and every configured interval (default turns 1, 30, 60). A fresh Provider session also receives them. These rules enter ordinary model Context so resumed Codex, Claude Code, and OpenClaw sessions receive periodic refreshes. Only a task handed to execution counts; commands, preparation failures, tool steps, automatic retries, and frozen same-generation card retries do not advance the counter. A failed refresh remains pending until a successful execution carries the rules. Custom session stores must preserve the optional `stableContext` binding state.

The complete `extra.im` namespace is owned by Channel Extras. Gateway ignores application-supplied `extra.im` items from static Context and `loadContexts` before constructing its own material, even when no corresponding item is due on this turn. Use another namespace for application material. Channel rule updates belong to the channel's own business logic; no external rule-source API is added here. Global `octo.control/instructions` retains its existing composition rules, and frozen retries retain the channel-generated snapshot.

Every admitted message carries separate compact `extra.im/message-trigger` JSON with one short English guidance sentence: `conversation` contains chat type and group/topic names and IDs; `sender` contains the actual actor's UID, name, and human/bot/unknown type; `recipient` identifies this Bot; `sentAt` is original message time in the system time zone with an explicit offset; `mentions` contains actual @ targets and broadcast flags. Names and identity types are resolved with this Bot's read-only API credentials within a shared five-second budget; unavailable names/times are null and missing types remain unknown. Sender and mention targets are distinct. Group/topic rules are checked against the authoritative API each new turn and supplied on changes or refresh turns; quotes, resources, rich text, and bounded history retain their own loading conditions. Explicit host Context continues to follow the existing per-task contract. Artifact delivery still uses the frozen effective policy even on turns that omit its explanatory Context. The shared renderer retains real line breaks; Gateway neither monitors compaction nor guarantees model retention between refreshes.

## Sessions and delivery

In the default `channel` mode, `artifact-delivery` guidance only asks for absolute-path Markdown links to local deliverables in the final reply, using image syntax for images. It does not direct or prohibit tool-based uploads. Explicit user requests for business actions continue through normal tool calls; Gateway's deterministic delivery policy remains enforced in code.

Local file references are attempted on Gateway's actual filesystem for every Provider, including preset OpenClaw Agents, without additional configuration or a default workspace restriction. Missing or unreadable files report their actual availability. Existing explicit `allowed_roots` still restrict access, and an empty list denies all files. Agent source does not establish file location; Gateway does not fetch remote Provider files.

In `message-trigger`, `conversation.id` is the original channel ID and `conversation.type` is `dm`, `group`, or `group_topic`. Topic conversations keep the full channel ID; their parent group and topic identifiers remain in `conversation.group.id` and `conversation.topic.id`.

Resolved user/Bot names and types are cached in memory for ten minutes, partitioned by API/Bot/Space, with at most 2,000 entries per Bot. Reads do not extend expiry; failures and missing records are not cached. Optional enrichment errors do not block AgentRun or trigger retries or alternative API lookups. Cancellation still propagates. This cache is not used for membership authorization or outgoing mention validation.

Automatic history is an oldest-first `messages: [{uid, username, sentAt, content}]` array. All bodies are typed: plain text uses `content: {type: "text", text: "..."}`, replies retain their quotes, forwards retain nested messages, and rich text retains ordered blocks. Media references carry `read: false`; history preparation does not fetch their bytes. The serialized array is capped at 20 records and 8,000 Unicode code points with bounded nesting and explicit shortening/omission. Automatic model input has no separate `history-gap`: incomplete, unavailable, or omitted history adds a short English `note` beside `history.messages`. Failures can use an empty message array; normal history has no note. Internal retrieval and handoff metadata stays in Gateway.

- Chat-to-session bindings live in an `ImSessionStore`. The default `MemoryImSessionStore` is bounded and does not survive a restart; provide `createSessionStore(botConfig)` to persist them. The store never holds full Provider history and cannot resume an unfinished Run.
- Gateway prepares this turn's Context before model execution. A new logical session may include recent chat preceding the trigger; group/topic history gaps are filled under fixed rules, capped at 20 messages and 8000 Unicode code points. Failure does not block the current task. Host/Adapter do not fetch chat history themselves; additional business investigation remains the Agent's task.
- Files referenced in a successful final are uploaded as IM attachments: 20 MiB per file, 50 MiB per turn, 16 distinct files, 30 seconds of preparation. Partial failures keep the successful links and name the files that were not delivered.
- A `session.update` from the Adapter is opaque Provider binding data, not application history.

During model silence, Gateway updates the original reasoning card's footer after 30 seconds and every 30 seconds thereafter. Assistant text or public reasoning clears the notice; tools, approvals, and user-input waits pause the clock. After 300 seconds of continuous model silence, Gateway requests cancellation without replaying the task. Stop remains available while cancellation is pending; Retry is offered only after the original execution has verifiably ended. This interval also applies after earlier output and after tools, rather than measuring only time to first output. Explicit execution limits can terminate a turn earlier.

## Working capacity and per-session queues

Each Bot has **64 working slots**. A slot serves one logical session, with one message being processed at a time. That session can also hold **4 queued messages**, which wait their turn and do not consume additional working slots. Preparation, model/tool/user waits, internal retries, and necessary delivery cleanup keep the slot occupied.

A session is scoped to one Bot and one private chat, group, or topic. Different senders in the same group share its queue; a separate topic has its own queue.

These examples assume authorized, distinct messages and a running Gateway. Each row describes one Bot:

| Situation | Working slots | Queued messages | What happens next |
| --- | --- | --- | --- |
| Session A processes A1; A2/A3/A4/A5 wait | 1 | 4 | A6 is rejected because A's queue is full. |
| 20 sessions each process 1 message and queue 4 | 20 | 80 | 100 messages are accepted; 44 working slots remain available for new or idle sessions. |
| 64 sessions each process 1 message, with no queues | 64 | 0 | A can still queue A2/A3/A4/A5: working slots stay at 64 and queued messages become 4. |
| All 64 slots are occupied and A already queues 4 | 64 | 4 | A6 is rejected for A's full queue; other working sessions can still fill their own queues. |
| All 64 slots are occupied; new session Z sends Z1 | 64 | Unchanged | Z1 is rejected because it needs a working slot. An idle session with a historical binding also needs a slot. |

When A1 finishes and cleanup completes, A2 takes over A's slot: its queue falls from 4 to 3 while working slots stay at 64. Only after A's last message and cleanup finish is that slot available to another session. A cancellation acknowledgement alone does not release it. Rejected messages are not retried automatically; send again after capacity becomes available. Bot slot exhaustion reports `OH-RUN-2003`; session queue exhaustion reports `OH-RUN-2004` and takes precedence when both limits apply. Neither rejection starts execution or marks the message read.

Per-Bot status reports `workingTasks` for occupied slots and `queuedTasks` for waiting messages. Historical chat-to-session bindings are counted separately: they consume neither resource, and `sessions` lists only current scheduling entries. The default memory store has its own capacity and expiry; see the [session storage contract](../../.octospec/rules/session-reset.md#当前内置-im-存储). These Gateway limits do not specify daily session throughput, guarantee 64 simultaneous model executions, or apply to WeCom.

## Lifecycle and status

`status()` returns `{ bots, errors }`: valid bots report connection, delivery, and session counts, while an invalid bot is reported by index and error code without blocking the others. `loaded` does not mean every bot is online.

| Bot `state` | Meaning | `connected` / `error` |
| --- | --- | --- |
| `stopped` | Not started, disabled, or stopping/stopped | `false` / `null` |
| `connecting` | Initial connection attempt | `false` / `null` |
| `online` | Authentication, registration, and WebSocket handshake completed | `true` / `null` |
| `retrying` | Recovering from a transient failure, including an initial failure; waiting or reconnecting | `false` / last connection error code |
| `failed` | Missing credentials, a confirmed terminal rejection, or connection cleanup failure | `false` / connection error code; cleanup failures also emit a disposal diagnostic |

Both an initial transient failure and a later transient disconnect recover automatically. After the failed connection is cleaned up, Gateway waits **5, 10, 15, then 15 seconds for each further failed attempt**. A server `Retry-After` can lengthen that attempt's wait. Connection attempts and cleanup take additional time, so these intervals are not an uptime guarantee. Full success clears `error` and resets the sequence: the next disconnect starts again at 5 seconds. Registration alone is not full success.

For example, an initial HTTP 503 enters `retrying`. If the retry after 5 seconds fails again, the next wait is 10 seconds; after another failure it is 15 seconds, remaining at 15 seconds until recovery. Missing credentials and explicit authentication, permission, configuration, or protocol rejections enter `failed` instead. Gateway does not poll for missing credentials; fix the cause and restart the Extra. Valid server disconnects, including reason 12 and unknown disconnect reasons, normally retry. HTTP timeouts, conflicts, rate limits, and server failures also retry; an explicit terminal rejection still stops recovery.

Stopping or unloading cancels pending reconnect timers and connection attempts. Provider execution, cards, and delivery have separate diagnostics: `online` proves connection health, not that a task completed or a reply was delivered.

`close()` cancels the connection, execution, and delivery work the plugin owns. Await it and check `complete` before replacing the Extra; it does not stop Kernel or other Extras. Cleanup failures surface as `EXTRA_DISPOSE_FAILED`.

## CLI deployment

Saved declarations live at `<home>/extras/channel-gateway/config.json` (POSIX `0600`). After editing a running background service, use `octo-runtime channel-gateway restart`. For foreground operation, stop the old process before running `octo-runtime channel-gateway run` again. Both `octo-runtime status` and `octo-runtime channel-gateway status` show system service state, Kernel availability, and the Bot/task summaries returned by Gateway; add `--json` for the full public status. Service readiness and each Bot's connectivity remain separate facts. Saving configuration does not install packages, connect immediately, or change the running instance.

## Import and distribution

Published entry: `@mininglamp-oss/octo-runtime/extras/channel-gateway`. The private workspace package name is for source and submodule hosts.

## Further reading

- [Implementation](src/index.ts), [dynamic Context guide](../../.octospec/guides/channel-dynamic-contexts.md), [channel contract](../../.octospec/rules/channel-integration.md).
- [Gateway guide](../../SDK_CHANNEL_GATEWAY_GUIDE.md), [Host SDK](../octo-runtime-host-sdk/README.md).
