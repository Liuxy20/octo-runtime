# Integrate Extras

For CLI setup, use `<extra> configure` or `<extra> config set`. See [Extra-owned commands](extra-commands.md). `extraset`/`extraget` are advanced interfaces for manually written full JSON declarations.

[简体中文](../../zh-CN/guides/extras.md) | [Documentation](../README.md)

An Extra connects a business system to Kernel. For example, an IM Extra receives chat messages, prepares invocation parameters, calls Kernel, and sends Agent replies back to chat. Direct SDK calls to Kernel do not need an Extra.

Import `createExtraService` from `@mininglamp-oss/octo-runtime/host` and supply:

- `endpoint`: the existing Kernel address. Extra connects to it without starting Kernel.
- `module`: the Extra module, such as Channel Gateway, WeCom, or WebUI.
- `config`: the JSON configuration required by that module.
- `dependencies`: application functions, such as loading Context or creating session storage.

Call `initialize()` to start, `status()` to inspect, and `close()` on exit. Built-in modules use the main package's `/extras/channel-gateway`, `/extras/channel-wecom`, and `/extras/webui` import paths. Each module's `/config-schema.json` subpath provides its configuration schema.

## Load Business Data Each Turn

```mermaid
flowchart TB
  Host[Application configuration and storage] --> SDK[createExtraService]
  SDK --> Plugin[Initialize Extra plugin]
  Plugin --> Load[Call loadContexts for each new task]
  Load --> Snapshot[Obtain this turn's Context]
  Snapshot --> Invoke[ctx.kernel.invoke]
  Invoke --> Delivery[Extra consumes and delivers results]
```

Channel Gateway can load background through `GatewayDependencies.loadContexts(config, {signal})`. The function returns `readonly ContextItem[]`, synchronously or asynchronously. Gateway calls it for every accepted task, so the next turn can read updated application data without restarting Extra.

Gateway merges the result with static Context. A dynamic item replaces the entire static item with the same `namespace` and `name`, including its `payload`; fields are not merged individually. This is Channel Gateway behavior and does not run automatically for direct Kernel calls.

After resolving the application's Context, Octo Gateway appends its default English mention instructions to the effective `octo.control/instructions.payload.entries`: `entries = [...hostEffectiveEntries, ...gatewayDefaultEntries]`. Instructions configured through CLI `extraset` belong to the application and come first. Each list retains its order and duplicate entries; the result contains one instructions item. Gateway builds it for each newly prepared turn without modifying application input or accumulating prior results. A same-generation card retry reuses the entire frozen Context, including already composed instructions, without appending defaults again or reloading application data or history. This additional step does not change static/dynamic replacement, public Context merging, or other Extras.

By default, Gateway waits up to 5 seconds for loading and allows at most 8 unfinished loading operations, configurable up to 32. Results are limited to 32 items and 64 KiB when serialized. A timeout stops waiting but does not stop the underlying operation; it occupies a concurrency slot until it finishes. Wrapping synchronous database work in an `async` function does not prevent event-loop blocking.

Gateway's default instructions also count toward the final invocation's Context limits. Supplying the maximum amount of application Context does not reserve capacity for Gateway additions. Gateway may omit automatic supplementary material under budget pressure, but fails rather than silently dropping default instructions or explicit application items.

## Octo Mentions and Bot Handoffs

When the current user explicitly requests a human notification or a handoff to a Bot in the current group, the model confirms the target's real UID and writes `@[uid:displayName]` in the successful final reply. Gateway validates current membership and an explicit human flag (`robot=0/false`) or Bot flag (`robot=1/true`), then sends readable text and native `mention.uids/entities` on the original reply connection. Plain `@name` does not notify. Unknown targets fall back to plain text; code, quoted examples, progress, thinking, and failed replies are not converted. This does not enable broadcasts, duplicate CLI sends, or unsolicited Bot calls.

When `allowed_sender_ids` is omitted, Gateway relies on the platform's DM admission/access policy and adds no sender restriction in groups or topics. Owners, other users, and other Bots can trigger a run, subject to Space, group enablement/scope, and native mention checks. An explicit list admits only listed senders, without implicitly adding the owner; `[]` rejects everyone and `null` is invalid. Gateway does not maintain a separate friend list or enforce an additional friends-only policy. Card controls must still match the original task initiator, Space, card message, and channel address.

Gateway rejects its own messages before command handling, Context preparation, or AgentRun dispatch, including self mentions and AI broadcasts, even if its own UID is in `allowed_sender_ids`. This applies to direct messages, groups, and topics.

The complete English rule block uses `[OCTO_CHANNEL_MENTION_RULES_V1]` boundaries and is passed through the normal session instruction channel for a new Provider session. A shorter English reminder in ordinary `extra.im/mention-instructions` material is supplied each turn, including continued sessions created before the upgrade; automatic supplementary material remains subject to the budget policy above. The reminder does not update an existing session's system instructions or reset it. The full block asks the model to retain it verbatim during summarization or compaction; retention depends on the model, without a Runtime compaction exemption or interception mechanism. See [Context and Sessions](context-and-sessions.md).

## Store Sessions

Use `GatewayDependencies.createSessionStore(botConfig)` to supply independent session storage for each Bot. Without this function, Gateway uses memory storage with a capacity limit.

Your application chooses the storage implementation. Runtime does not depend on SQLite or manage application database schemas and migrations. Wait for Extra's output consumption and storage operations before closing the database. See the existing Chinese [Gateway integration guide](../../../SDK_CHANNEL_GATEWAY_GUIDE.md) for detailed business configuration and storage implementations.

## Develop an Extra

The plugin entry point has the form `extra(context, jsonConfig)(dependencies)`. Put configuration values in `jsonConfig` and application functions in `dependencies`. The plugin and those functions run in the same process.

Use `ctx.kernel.invoke` to call the shared Kernel, `ctx.onDispose` to register cleanup, `ctx.onStatus` to report business status, and `ctx.log` for diagnostics. Applications manage the plugin through these public APIs without accessing its internals or adding another execution forwarding interface.

## Close an Extra

```mermaid
sequenceDiagram
  participant Host
  participant Extra as Extra service
  participant Plugin
  participant Kernel
  participant DB as Host storage
  Host->>Extra: close()
  Extra->>Plugin: stop receiving tasks and begin cleanup
  par Within the same deadline
    Extra->>Kernel: cancel and await this Extra's invocations
  and Finish business processing
    Plugin->>DB: await output consumption, saves and delivery
    Plugin-->>Extra: cleanup finishes
  end
  Extra-->>Host: cleanup result
  Host->>Kernel: close the application's Kernel
  Host->>DB: close storage after business operations finish
```

`close()` stops new invocations, notifies the plugin to clean up, and cancels and awaits this Extra's submitted invocations. These operations share a default 4-second shutdown deadline, or an earlier deadline inherited from the caller.

During cleanup, the plugin can still call application dependency functions to finish saving and delivering results. New dependency calls are rejected after plugin cleanup finishes or the deadline expires. Functions already running cannot be forcibly stopped; the service continues tracking unfinished operations.

Inspect `complete`, `errors`, and `pendingResources` in the result. `complete=false` means some work or resources remain unresolved, so do not treat shutdown as complete. The database remains application-managed; the SDK does not close it automatically.

Closing one Extra does not close the shared Kernel or stop other Extras' invocations. In status results, `phase` is the Extra service's lifecycle stage, `kernel_available` reports whether Kernel can currently execute, and `plugin` contains the plugin's business status. Check the corresponding status and connection results to confirm whether a Bot or Provider is online.

Sources: [Extra API](../../../packages/octo-runtime-host-sdk/src/extras.ts), [service](../../../packages/octo-runtime-host-sdk/src/extra-service.ts), [Gateway entry](../../../packages/octo-runtime-extra-channel-gateway/src/extra.ts), [instruction composition](../../../packages/octo-runtime-extra-channel-gateway/src/execution/dispatcher.ts), [mention rules and conversion](../../../packages/octo-runtime-extra-channel-gateway/src/transport/mentions.ts), [message admission](../../../packages/octo-runtime-extra-channel-gateway/src/transport/normalize.ts).
