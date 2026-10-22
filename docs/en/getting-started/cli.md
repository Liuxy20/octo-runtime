# CLI Installation and Invocation

[简体中文](../../zh-CN/getting-started/cli.md) | [Documentation](../README.md)

Use the Runtime CLI to start Executor Kernel, inspect Adapters, and try an Agent invocation. Use Node.js 24.x.

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

These commands install the published npm packages. On 2026-10-21, the Runtime registry `latest` was still `1.0.1`, which uses the old daemon architecture. The commands below require a release whose help lists `executor-kernel`; until that release is published, use the source build below. See [deployment instructions](../../../DEPLOYMENTS.md) before replacing an existing daemon installation.

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

See [SDK setup](sdk.md) for endpoint handling and event consumption. Registering Kernel does not start `channel-gateway`; configure and start that Extra separately when integrating Octo IM. See [Extras](../guides/extras.md) and the [full CLI operations guide](../../../CLI_USAGE_GUIDE.md).

## Let the Agent Use octo-cli

Install `octo-cli` on the machine where the Harness executes tools, and make it available on that process's `PATH`. Provide the Octo credentials through the execution environment, such as `OCTO_BOT_TOKEN` and, when needed, `OCTO_API_BASE_URL`; use the [environment Context](../reference/contexts.md) for per-invocation settings rather than placing credentials in model text.

The Channel Gateway prepares these business environment variables for its invocations. OpenClaw executes tools in its separate Gateway process, so its tool environment must be configured there; the CLI can synchronize the selected OpenClaw bot's variables for a discovered local Gateway, which then needs restarting. A remote Gateway needs its own environment configuration.

`octo-cli` has its own account selection rules: explicit `--profile` or `--bot-id` selection takes precedence over environment credentials. Without an explicit selector, environment credentials take precedence over implicitly selected stored profiles; `OCTO_TOKEN` takes precedence over `OCTO_BOT_TOKEN`. When an Agent uses the wrong Octo account, check its command-line selectors and execution environment. This order is checked against the [credential implementation at revision 3d39abd](https://github.com/Mininglamp-OSS/octo-cli/blob/3d39abddc64a75de5570ebd0b6548b091c682df5/internal/cmdutil/factory.go); see the [octo-cli installation and authentication guide](https://github.com/Mininglamp-OSS/octo-cli#readme) for current commands and configuration.

Sources: [CLI help](../../../apps/cli/src/help.ts), [Home and profile paths](../../../apps/cli/src/state.ts), [OpenClaw setup](../../../apps/cli/src/openclaw.ts), [Octo tool environment](../../../packages/octo-runtime-extra-channel-gateway/src/execution/tool-environment.ts).
