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

Manage the registered service with:

```sh
octo-runtime executor-kernel restart
octo-runtime executor-kernel stop
octo-runtime executor-kernel uninstall
```

Global options are `--home <path>`, `--profile <name>`, and `--manifest <path>`. Use the same Home for commands targeting one service. A profile selects configuration within that Home; it does not create another Kernel service. The default Home is `~/.octo-runtime` on macOS/Linux and `%LOCALAPPDATA%\OctoRuntime` on Windows when `LOCALAPPDATA` is set; `OCTO_RUNTIME_HOME` overrides it.

## Configure Octo IM Gateway

A bot runs through the `channel-gateway` Extra. Save its declaration, replacing every placeholder:

```bash
octo-runtime extraset channel-gateway <<'JSON'
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "config": {
    "bots": [
      {
        "api_url": "https://im-test.deepminer.com.cn/api",
        "bot_id": "<OCTO_BOT_ID>",
        "bot_name": "local-assistant",
        "bf_token": "bf_REPLACE_WITH_REAL_BOT_TOKEN",
        "adapter": {
          "adapter_type": "codex",
          "workdir": "/absolute/workspace"
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

Saving does not connect the bot, install the plugin, or restart the component. Every `extraset` replaces the whole declaration and never merges by `bot_id`, so all bots go into one `config.bots` array. `module` may be omitted, and when present it must match the effective manifest. On POSIX the file mode is `0600`.

With a background Gateway running, apply the change and check the result:

```bash
octo-runtime channel-gateway restart
octo-runtime status
```

`extraget channel-gateway` returns the full configuration including credentials; never paste its output into logs.

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

`<extra-name>` is `channel-gateway`, `channel-wecom`, `webui`, or a name saved through `extraset`. These actions follow the same autostart and readiness rules as Kernel, and Extras may start before Kernel: they report Kernel unavailable and recover once it is up.

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

The CLI selects Adapters and Extras from its built-in manifest plus `<Home>/manifest.json`. Both have `adapters` and `extras`; declaring an Extra does not enable or start it. `--manifest` replaces both sources completely. See [Adapter and Extra Loading](../concepts/module-loading.md) for examples, resolution anchors and migration of legacy Extra `module` settings.

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
