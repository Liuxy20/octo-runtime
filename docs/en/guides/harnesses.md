# Harness Installation and Configuration

[简体中文](../../zh-CN/guides/harnesses.md) | [Documentation](../README.md)

A Harness is the Agent program behind an Adapter: it manages model calls, tools, and sessions. Install and authenticate the Harness under the operating-system account that runs Runtime; the Adapter itself is bundled with Runtime and needs no separate global installation.

## Choose a Harness

Each row gives a short setup summary and the official documentation. The launch column records this source revision's default command; Runtime supplies the protocol flags and task content.

| Adapter type  | Runtime launches                                                          | Harness setup                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`       | `codex app-server`                                                        | Install Codex CLI using the [official installation guide](https://developers.openai.com/codex/cli), then run `codex` and sign in. Runtime reuses the account and configuration in `CODEX_HOME`, defaulting to `~/.codex`.                                                                                      |
| `claude-code` | `claude --print --input-format stream-json --output-format stream-json …` | Install Claude Code with its [official native installer](https://code.claude.com/docs/en/quickstart), then run `claude` to complete sign-in. Make the `claude` executable and its account configuration available to Runtime's operating-system user.                                                          |
| `codebuddy`   | `codebuddy --acp …`                                                       | Install with `npm install -g @tencent-ai/codebuddy-code`, then run `codebuddy` and complete browser sign-in for your account's region. See the [official quickstart](https://www.codebuddy.cn/docs/cli/quickstart) and the WorkBuddy credits section below.                                                    |
| `hermes`      | `hermes acp`                                                              | Install Hermes Agent and its ACP extra following the [official ACP guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/). Configure its model credentials with `hermes model` and verify ACP with `hermes acp --check`.                                                                  |
| `kimi-code`   | `kimi acp`                                                                | Install Kimi Code CLI with the [official installer or npm package](https://moonshotai.github.io/kimi-code/en/guides/getting-started.html), then run `kimi` and use `/login`. Configure the default model in Kimi before selecting this Adapter.                                                                |
| `mcode`       | `mcode acp`                                                               | Install MiniMax Code using its [official installation guide](https://github.com/MiniMax-AI/minimax-code#readme), then run `mcode login` or `mcode login --region global` for the matching account. Select its model inside MCode; this Adapter does not support an explicit per-invocation model override.     |
| `qodercli`    | `qodercli --acp`                                                          | Follow the [Qoder CLI installation and sign-in guide](https://docs.qoder.com/cli/installation). New installations use the `qoder` command, while this Adapter expects `qodercli`; use a compatible installation or an executable wrapper forwarding arguments to a version that supports `--acp`.              |
| `qoderclicn`  | `qoderclicn --acp`                                                        | Install and sign in to the China distribution using the [Qoder CN guide](https://docs.qoder.cn/cli/installation). Ensure Runtime can execute `qoderclicn` with ACP support; verify the installed command name because upstream distributions can change.                                                       |
| `opencode`    | `opencode run --format json --thinking --auto …`                          | Install the compatible OpenCode CLI and configure a model account through `/connect`, following the [official guide](https://dev.opencode.ai/docs/). Check support for these flags in the installed version; the current Adapter only accepts approval mode `full_access`.                                     |
| `openclaw`    | Connects to an existing Gateway                                           | Install OpenClaw, complete onboarding, and start its Gateway using the [official getting-started guide](https://docs.openclaw.ai/start/getting-started). Configure the Runtime connection and specify `provider_agent_id`, such as `main`; starting Executor Kernel does not start that Gateway.               |
| `zcode-gui`   | ZCode Desktop's embedded client                                           | Install [ZCode Desktop](https://zcode.z.ai/cn/docs/install) and configure the model account in the application. The Adapter checks `ZCODE_BIN`, then `PATH`, then desktop installation locations; use `ZCODE_BIN` if the client is not detected.                                                               |
| `antigravity` | `agy` in stream-json headless mode                                        | Install Antigravity CLI using the [official setup guide](https://antigravity.google/docs/getting-started?tab=cli), then run interactive `agy` once to authenticate. Keep the executable on Runtime's `PATH`; see the [headless guide](https://antigravity.google/docs/cli/headless/) for required CLI support. |

`dsh` runs an installed DeepSeek Harness 0.2.1-rc.3 through `dsh --profile sdk` or the macOS Desktop embedded CLI. Sign in to Desktop under the same OS account. It defaults to deepseek-account and requires explicit full_access. See the [DSH Adapter](../../../packages/octo-runtime-adapter-dsh/README.md) for discovery, SDK registration and configuration boundaries.

Generic `acp` is a reusable Adapter factory for another ACP-compatible Harness, not a separate Harness to install. Configure its command and arguments through `createAcpAdapter` and register the resulting Adapter in your worker or manifest; it is not an entry in the default CLI manifest. See the [factory implementation](../../../packages/octo-runtime-adapter-acp/src/index.ts) and [ACP documentation](https://agentclientprotocol.com/get-started/introduction).

After installation, follow [CLI Installation and Invocation](../getting-started/cli.md) to probe the selected Adapter and send a small request. Shell aliases are not executable programs for the worker; background services also need the correct `PATH`, home directory, and account configuration. Restart the service after changing its environment.

## Enable Codex Computer Use

1. In the supported desktop app, open Codex, then **Plugins → Computer Use**; install or enable the plugin and turn on its server and skill.
2. On macOS, grant Screen Recording and Accessibility when prompted. Run **Try now** to check access.

Availability and platform setup follow [OpenAI's Computer Use documentation](https://learn.chatgpt.com/docs/computer-use).

For Runtime, run the worker as the same operating-system user with the same `CODEX_HOME`. The [Codex Adapter](../../../packages/octo-runtime-adapter-codex/src/index.ts) starts `codex app-server` with that real home, so existing Codex configuration and plugin state remain available. There is no Runtime `computer_use: true` setting, and `full_access` does not install the plugin or grant operating-system permissions.

The official setup above enables the desktop feature. Whether that installation exposes the required tools to the installed CLI/app-server must also be verified with a Runtime invocation; this documentation's automated tests do not establish Computer Use compatibility. If the tools are missing, check the Codex version, `CODEX_HOME`, plugin setup, and app-server tool availability before changing Runtime MCP settings. Applications must also handle any supported approval requests; see [Output and Control](../reference/output-and-control.md).

## Share WorkBuddy Credits with CodeBuddy

The [WorkBuddy China pricing page](https://www.codebuddy.cn/docs/workbuddy/Pricing) states that CodeBuddy and WorkBuddy share credits under the same account. The plan must also include CLI access; do not assume that an account's desktop access includes CLI access.

1. Start `codebuddy` and sign in using the same account and regional service as WorkBuddy. If another account is active, use `/logout` and `/login` inside CodeBuddy.
2. Check `/status` and the account's usage page before selecting `codebuddy` in Runtime. Runtime uses that Harness authentication; it has no separate credit-sharing switch.

See [CodeBuddy sign-in](https://www.codebuddy.cn/docs/cli/quickstart) and [interactive commands](https://www.codebuddy.cn/docs/cli/slash-commands). If usage is charged elsewhere, check configured API credentials and endpoints against the [authentication guide](https://www.codebuddy.cn/docs/cli/iam); a separate API key or enterprise service may use a different billing arrangement. Account sharing does not require copying WorkBuddy credential files, and the China personal-plan statement does not establish cross-region or enterprise entitlement.

Harness setup links were checked on 2026-10-21. Installation commands, feature availability, and account entitlements can change; refer to the linked vendor pages for updates. Adapter behavior and support limits are recorded in [Provider Support](../reference/providers.md).
