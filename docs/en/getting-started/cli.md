# CLI Installation and Operations

[简体中文](../../zh-CN/getting-started/cli.md) | [Documentation](../README.md)

Use the Runtime CLI to install, start, and operate Executor Kernel and the optional Extras, inspect Adapters, and try an Agent invocation. Use Node.js 24.x or 26.x (LTS).

## Which Programs to Install

| Program                               | Purpose                                                                    | When needed                                 |
| ------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `octo-runtime`                        | Starts and manages Runtime services; includes the SDK and bundled Adapters | Running Runtime from the terminal           |
| `octo-cli`                            | Calls Octo business APIs, including messaging, documents, Drive, and Loop  | Your Agent uses these Octo tools            |
| A Harness such as `codex` or `claude` | Runs the Agent, calls its model, and executes tools                        | Install the Harness selected by the Adapter |

Install Runtime and the Octo business CLI separately:

```sh
npm install -g @mininglamp-oss/octo-runtime
npm install -g @mininglamp-oss/octo-cli
octo-runtime --version
octo-runtime --help
octo-cli --help
```

These commands install the published npm packages. The commands below require a release whose help lists `executor-kernel`; if the installed release does not, use the source build below.

From this repository, use the pnpm version declared in `package.json`:

```sh
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
```

For source builds, replace `octo-runtime` in subsequent commands with `node apps/cli/dist/index.js`, running from the repository root. Installing Runtime does not install or sign in to a Harness; follow [Harness Installation and Configuration](../guides/harnesses.md).

## Start Executor Kernel

For a first local run, keep Kernel in the foreground:

```sh
octo-runtime executor-kernel run
```

In a second terminal, inspect the running Kernel:

```sh
octo-runtime status --json
octo-runtime adapter list
octo-runtime adapter probe codex
octo-runtime doctor
```

Replace `codex` with the Adapter type you plan to use. A successful probe checks what that Adapter reports; it does not prove that account credits, model access, or every tool works. Confirm execution with a small invocation.

For a service managed by the operating system, stop the foreground process first, then register and start the service:

```sh
octo-runtime executor-kernel install
octo-runtime executor-kernel start
```

`install` registers the selected service and enables autostart by default on first and repeated installs. Use `--autostart=false` to disable it explicitly. `start` automatically installs a missing component with progress on stderr; existing services keep their settings. Successful `start` and `restart` include component status. Status is readable text by default; use `--json` for formatted machine output. Service management uses launchd on macOS, systemd user services on Linux, and Task Scheduler on Windows. Kernel and Extras have independent autostart and can start in either order.

`restart` does not install a missing service; it returns exit code 3. An explicitly disabled service rejects both `start` and `restart` with `SERVICE_DISABLED`. Run `octo-runtime executor-kernel install --autostart=true` to enable it, then run `start`. A plain `install` also enables autostart again. For foreground execution, use `run` without registering a system service.

Manage the registered service with:

```sh
octo-runtime executor-kernel restart
octo-runtime executor-kernel stop
octo-runtime executor-kernel uninstall
```

Global options are `--home <path>`, `--profile <name>`, and `--manifest <path>`. Use the same Home for commands targeting one service. A profile selects configuration within that Home; it does not create another Kernel service. The default Home is `~/.octo-runtime` on macOS/Linux and `%LOCALAPPDATA%\OctoRuntime` on Windows when `LOCALAPPDATA` is set; `OCTO_RUNTIME_HOME` overrides it.

The global `--version` / `-v` flag prints the installed artifact's version, commit and build time. It works before or after commands, including Extra subcommands, without loading modules or requiring valid configuration. After `--`, it remains a literal argument.

## Configure the three built-in Extras

Use `configure` without constructing JSON manually. Replace the placeholders below; business options match configuration field names.

### channel-gateway

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "<BOT_TOKEN>"
```

Each call configures one Bot. Repeat it to update an existing `bot_id`, including its endpoint, or append a new ID to `config.bots`. Omitted fields and other Bots are preserved. Legacy entries sharing an ID across endpoints collapse into the first matching entry, preserving its omitted fields. Business option names match configuration fields; credentials are passed directly as strings.

Optional options: `--model` and `--effort` (low/medium/high/xhigh). For OpenClaw use `--adapter_type openclaw` and `--provider_agent_id main`, without `--workdir`; when switching an existing local adapter, remove its old workdir through the Extra’s `extraset`.

### channel-wecom

```sh
octo-runtime channel-wecom configure \
  --bot_id assistant \
  --ws_url wss://openws.work.weixin.qq.com \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "<APP_SECRET>"
```

Each call configures one Bot. Repeat it to update an existing `bot_id`, including its endpoint, or append a new ID to `config.bots`. Omitted fields and other Bots are preserved. Legacy entries sharing an ID across endpoints collapse into the first matching entry, preserving its omitted fields. Business option names match configuration fields; credentials are passed directly as strings.

Optional options: `--model` and `--effort` (low/medium/high/xhigh). For OpenClaw use `--adapter_type openclaw` and `--provider_agent_id main`, without `--workdir`; when switching an existing local adapter, remove its old workdir through the Extra’s `extraset`. `--ws_url` is optional: updates preserve the existing endpoint; new Bots use the official default.

### webui

```sh
octo-runtime webui configure \
  --port 13888
```

`configure` accepts only `--port`. The initial session file is `<home>/extras/webui/sessions.json`; existing paths and project settings are preserved. There is one WebUI configuration per Home. Custom paths use the advanced JSON interface below, with the existing `sessionStorePath` and `defaultProjectPath` fields.

### Start services and inspect help

Configuration only saves; it does not start, enable, or reload services. Start each component as needed for first use; use its `restart` after changing a running service.

```sh
octo-runtime executor-kernel start
octo-runtime channel-gateway start
octo-runtime channel-wecom start
octo-runtime webui start
```

```sh
octo-runtime -h
octo-runtime channel-gateway -h
octo-runtime channel-gateway configure \
  --help
octo-runtime channel-wecom configure \
  --help
octo-runtime webui configure \
  --help
```

Root help retains the version, commit, and build time at the top. Commands prioritize `executor-kernel`, `channel-gateway`, `channel-wecom`, and `webui` when present, followed by other effective commands sorted by name. Extra help lists shared lifecycle and full JSON commands before extension-owned commands. A separate `Examples` section follows `Usage`. `--home` and `--manifest` remain global and work before or after configuration commands. Extra configuration belongs to Home and does not accept `--profile`. See [Extra-owned commands](../guides/extra-commands.md).

### Advanced: write JSON manually

Advanced usage: use the Extra’s `extraset/extraget` subcommands for a complete JSON declaration containing `config` and optional `module`/`enabled`. Business commands are defined by each Extra; built-in Extras no longer provide `config set/get`.

```sh
octo-runtime channel-gateway extraset \
  < channel-gateway-declaration.json
octo-runtime channel-gateway extraget
```

`extraset` replaces the entire declaration without merging by bot_id or preserving omitted fields. Read commands return their complete JSON, including channel credentials. Restart a running Extra after saving.

Each Extra has its own configuration schema. Complete Octo Gateway declaration:

```bash
octo-runtime channel-gateway extraset <<'JSON'
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "config": {
    "bots": [
      {
        "api_url": "https://im-test.deepminer.com.cn/api",
        "bot_id": "<OCTO_BOT_ID>",
        "bot_name": "local-assistant",
        "bf_token": "<BOT_TOKEN>",
        "adapter": {
          "adapter_type": "codex",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        },
        "context": {
          "schema": "octo.context-envelope/v3",
          "items": [
            {
              "namespace": "octo.control",
              "name": "instructions",
              "payload": { "entries": [{ "text": "You are the local assistant." }] }
            }
          ]
        }
      }
    ]
  }
}
JSON
```

Both `model` and `effort` are optional. When omitted, the selected Harness uses its own defaults. Replace `<MODEL_ID>` with a model identifier supported by that Harness; `effort` accepts `low`, `medium`, `high`, or `xhigh`, subject to Harness support.

Complete WeCom declaration:

```bash
octo-runtime channel-wecom extraset <<'JSON'
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-wecom",
  "enabled": true,
  "config": {
    "bots": [
      {
        "bot_id": "<WECOM_BOT_ID>",
        "app_secret": "<APP_SECRET>",
        "adapter": {
          "adapter_type": "codex",
          "workdir": "/absolute/workspace",
          "model": "<MODEL_ID>",
          "effort": "medium"
        }
      }
    ]
  }
}
JSON
```

Both `model` and `effort` are optional. When omitted, the selected Harness uses its own defaults. Replace `<MODEL_ID>` with a model identifier supported by that Harness; `effort` accepts `low`, `medium`, `high`, or `xhigh`, subject to Harness support.

`module` may be omitted; when provided, it must match the effective manifest. Include every Bot in `config.bots`; `extraset` does not perform configure’s ID-based updates. POSIX file permissions are `0600`.

### Provider and admission settings

- Claude Code: set `adapter_type` to `claude-code`; `model` and `effort` may be omitted.
- OpenClaw: use `{ "adapter_type": "openclaw", "provider_agent_id": "main" }` and no `workdir`; OpenClaw starts its own Gateway.
- A local Provider with no `workdir` gets `~/octo-runtime/channels/{bot_id}`, independent of the CLI Home.
- `groups_enabled: false` closes groups and topics; omitting `group_ids`, `null`, or `[]` all mean no extra range limit.
- Omitting `allowed_sender_ids` adds no restriction; an explicit list only admits those senders, `[]` denies everyone, and `null` is invalid.

## Extra Components and Logs

```text
octo-runtime <extra-name> install|start|restart|stop|status|uninstall|logs
```

`<extra-name>` is `channel-gateway`, `channel-wecom`, `webui`, or another name in the effective module catalog. These actions follow the same autostart and readiness rules as Kernel, and Extras may start before Kernel: they report Kernel unavailable and recover once it is up.

```bash
octo-runtime channel-gateway logs --lines 200
octo-runtime channel-gateway logs --follow --json
```

Logs carry component state only — initialization and shutdown, Kernel availability, connection and retry plans — with no chat text, identifiers, model output, or credentials. The CLI mirrors them to `<Home>/logs/extras/<extra>-status-<UTC hour>.log`, keeps the current file plus two archives capped at 100 MiB each, and `logs` reads at most 4 MiB.

## Diagnostics and Recovery

`status` reports native `service` state and IPC `runtime` state separately, and exit code 0 does not prove business readiness. `doctor` reports service-manager probing and service definitions; `adapter list` and `adapter probe` query a running Kernel without starting one.

Exit codes: 0 success; 2 invalid arguments or declaration; 3 component not installed; 4 unreachable or not ready; 5 incomplete cleanup; 1 other failure. Text errors go to stderr, JSON errors to stdout.

When a Windows crash leaves the tool tree in an unknown state, startup fails with `ORPHAN_CLEANUP_INCOMPLETE`. After confirming the leftovers stopped:

```bash
octo-runtime doctor --home <home>
octo-runtime executor-kernel recover --acknowledge-orphan-cleanup --home <home>
octo-runtime executor-kernel start --home <home>
```

Recovery acknowledges one manifest archive; it never kills unknown processes and never reports manual confirmation as verified cleanup.

## Try One Invocation

The CLI selects Adapters and Extras from its built-in manifest and `<Home>/manifest.json`, and discovers Extras in the current CLI’s global installation environment. Priority is built-in > Home > global. Declaring or discovering an Extra does not enable or start it. `--manifest` replaces these sources completely. See [Adapter and Extra Loading](../concepts/module-loading.md) for examples, resolution anchors and migration of legacy Extra `module` settings.

Create `request.json` with this content:

```json
{
  "protocol_mode": "canonical",
  "inputs": [{ "type": "text", "text": "Reply with OK without using tools." }],
  "contexts": {
    "schema": "octo.context-envelope/v3",
    "items": [
      { "namespace": "octo.execution", "name": "adapter", "payload": { "type": "codex" } },
      { "namespace": "octo.security", "name": "approval_policy", "payload": { "mode": "ask" } }
    ]
  }
}
```

Run it through the CLI:

```sh
octo-runtime playboard < request.json
```

`playboard` starts a temporary Kernel for this request; it does not submit to the persistent service. It writes events as NDJSON to stdout and diagnostics to stderr, and loads no Extras. An interaction requiring a reply ends with `PLAYBOARD_INTERACTION_REQUIRED`; use the SDK when your application needs to answer approvals or questions.

Change `payload.type` to select another installed Harness. OpenClaw also needs `provider_agent_id`, for example `main`. OpenCode currently requires approval mode `full_access`, which allows tools without individual approval; review [Provider support](../reference/providers.md) before selecting it.

To invoke the persistent Kernel from a source checkout, use the shared SDK example with its actual socket or Named Pipe endpoint:

```sh
node docs/examples/attach.mts /absolute/path/to/kernel.sock codex
```

See [SDK setup](sdk.md) for endpoint handling and event consumption. Registering Kernel does not start `channel-gateway`; configure and start that Extra separately when integrating Octo IM. See [Extras](../guides/extras.md) for wiring an Extra into your host.

## Let the Agent Use octo-cli

Install `octo-cli` on the machine where the Harness executes tools, and make it available on that process's `PATH`. Provide the Octo credentials through the execution environment, such as `OCTO_BOT_TOKEN` and, when needed, `OCTO_API_BASE_URL`; use the [environment Context](../reference/contexts.md) for per-invocation settings rather than placing credentials in model text.

The Channel Gateway prepares these business environment variables for its invocations. OpenClaw executes tools in its separate Gateway process, so its tool environment must be configured there; the CLI can synchronize the selected OpenClaw bot's variables for a discovered local Gateway, which then needs restarting. A remote Gateway needs its own environment configuration.

`octo-cli` has its own account selection rules: explicit `--profile` or `--bot-id` selection takes precedence over environment credentials. Without an explicit selector, environment credentials take precedence over implicitly selected stored profiles; `OCTO_TOKEN` takes precedence over `OCTO_BOT_TOKEN`. When an Agent uses the wrong Octo account, check its command-line selectors and execution environment. This order is checked against the [credential implementation at revision 3d39abd](https://github.com/Mininglamp-OSS/octo-cli/blob/3d39abddc64a75de5570ebd0b6548b091c682df5/internal/cmdutil/factory.go); see the [octo-cli installation and authentication guide](https://github.com/Mininglamp-OSS/octo-cli#readme) for current commands and configuration.

Sources: [CLI help](../../../apps/cli/src/help.ts), [Home and profile paths](../../../apps/cli/src/state.ts), [OpenClaw setup](../../../apps/cli/src/openclaw.ts), [Octo tool environment](../../../packages/octo-runtime-extra-channel-gateway/src/execution/tool-environment.ts).
