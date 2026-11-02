# Harness 安装配置

[English](../../en/guides/harnesses.md) | [文档目录](../README.md)

Harness 是 Adapter 背后实际运行 Agent 的程序，负责模型调用、工具执行和会话管理。请使用运行 Runtime 的操作系统账号安装并登录 Harness；Adapter 本身已包含在 Runtime 中，无需另外全局安装。

运行已安装的 Runtime CLI 或 SDK 需要 Node.js **24.x 或 26.x**（`^24.0.0 || ^26.0.0`），这不是仅针对源码编译的要求。Node.js 22 不在支持范围内，请先升级到 Node.js 24。

## Harness 专题

每个内置 Harness 均有独立的安装、认证、Channel Gateway 样例和代理说明。先读[完整 Gateway 声明与代理隔离](harnesses/channel-gateway.md)，再选择框架；不要将 Antigravity 的实测结果视为其他框架的验收。

- [Codex](harnesses/codex.md)
- [Claude Code](harnesses/claude-code.md)
- [CodeBuddy](harnesses/codebuddy.md)
- [Hermes Agent](harnesses/hermes.md)
- [Kimi Code](harnesses/kimi-code.md)
- [MiniMax Code](harnesses/mcode.md)
- [Qoder CLI](harnesses/qodercli.md)
- [Qoder CN CLI](harnesses/qoderclicn.md)
- [OpenCode](harnesses/opencode.md)
- [OpenClaw](harnesses/openclaw.md)
- [Antigravity](harnesses/antigravity.md)
- [DeepSeek Harness](harnesses/dsh.md)
- [Grok Build](harnesses/grok-build.md)

通用 ACP 工厂不是独立 Harness，也未在默认 CLI 注册。自定义 Harness 通过工厂和清单接入，详见[Adapter 开发指南](../../../.octospec/guides/adapter-authoring.md)；不能仅把 Bot 的 adapter_type 改成 acp 就认为已安装。

## 选择 Harness

每项简述安装配置方式，并附官网链接。“Runtime 启动方式”记录当前源码默认使用的命令，协议参数和任务内容由 Runtime 提供。

| Adapter 类型  | Runtime 启动方式                                                          | Harness 安装配置                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex`       | `codex app-server`                                                        | 按 [Codex 官方安装指南](https://developers.openai.com/codex/cli)安装 CLI，运行 `codex` 完成登录。Runtime 复用 `CODEX_HOME` 中的账号和配置，默认目录为 `~/.codex`。                                                                                   |
| `claude-code` | `claude --print --input-format stream-json --output-format stream-json …` | 使用 [Claude Code 官方原生安装器](https://code.claude.com/docs/en/quickstart)安装，运行 `claude` 完成登录。确保运行 Runtime 的操作系统账号能够找到 `claude` 命令并读取对应账号配置。                                                                 |
| `codebuddy`   | `codebuddy --acp …`                                                       | 使用 `npm install -g @tencent-ai/codebuddy-code` 安装，运行 `codebuddy`，选择账号所在区域并完成浏览器登录。详见[官方快速入门](https://www.codebuddy.cn/docs/cli/quickstart)，WorkBuddy 共享额度的操作见下节。                                        |
| `hermes`      | `hermes acp`                                                              | 按 [Hermes 官方 ACP 指南](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/)安装 Hermes Agent 及其 ACP 扩展依赖。通过 `hermes model` 配置模型凭据，并用 `hermes acp --check` 检查 ACP 是否可用。                                   |
| `kimi-code`   | `kimi acp`                                                                | 按[官方指南](https://moonshotai.github.io/kimi-code/en/guides/getting-started.html)使用安装器或 npm 安装 Kimi Code CLI，运行 `kimi` 后通过 `/login` 登录。选择该 Adapter 前，先在 Kimi 中配置默认模型。                                              |
| `mcode`       | `mcode acp`                                                               | 按 [MiniMax Code 官方安装指南](https://github.com/MiniMax-AI/minimax-code#readme)安装，运行 `mcode login`，国际账号则使用 `mcode login --region global`。模型在 MCode 中选择，当前 Adapter 不支持逐轮显式覆盖模型。                                  |
| `qodercli`    | `qodercli --acp`                                                          | 按 [Qoder CLI 官方指南](https://docs.qoder.com/cli/installation)安装并登录。新版安装使用 `qoder` 命令，而当前 Adapter 查找 `qodercli`；请使用兼容安装，或提供一个将参数转发给支持 `--acp` 版本的可执行包装程序。                                     |
| `qoderclicn`  | `qoderclicn --acp`                                                        | 按 [Qoder CN 官方指南](https://docs.qoder.cn/cli/installation)安装中国区版本并登录。确保 Runtime 能执行支持 ACP 的 `qoderclicn`，上游发行方式变化时需核对实际命令名。                                                                                |
| `opencode` | full_access 用 `opencode run …`；ask 用 `opencode acp` | 按[官方指南](https://dev.opencode.ai/docs/)安装 `>=2.1.3 <3` 的 OpenCode，并通过 `/connect` 配置模型账号。不支持 assisted；具体参数见 [OpenCode 专题](harnesses/opencode.md)。 |
| `openclaw`    | 连接已运行的 Gateway                                                      | 按 [OpenClaw 官方入门指南](https://docs.openclaw.ai/start/getting-started)安装、完成初始化并启动 Gateway。配置 Runtime 连接并指定 `provider_agent_id`，例如 `main`；启动 Executor Kernel 不会同时启动该 Gateway。                                    |
| `antigravity` | `agy` 的 stream-json 无头模式                                             | 按 [Antigravity 官方指南](https://antigravity.google/docs/getting-started?tab=cli)安装 CLI，先交互运行一次 `agy` 完成认证。确保 Runtime 的 `PATH` 能找到该可执行文件，所需 CLI 能力见[无头模式文档](https://antigravity.google/docs/cli/headless/)。 |

`dsh` 要求通过 npm 安装 **`0.2.1-rc.4` 或更高版本**的 `@deepseek-ai/dsh` Provider。这与 Adapter 内固定为 `0.2.1-rc.3` 的未修改官方 Client SDK 不同。Provider 使用 `sdk` profile。Runtime CLI 宿主自动将 PATH 中首个 `dsh` 解析为 npm 包的 JS 入口，通过 `providerOptions.dshBin` 同时传给 Kernel 发现与调用，`playboard` 使用同一逻辑。`<home>/<profile>/config.json` 中显式的 `adapters.dsh.execution.provider_options.dshBin` 优先，缺失或不兼容时不回退其他安装。SDK 宿主自行选择并传入入口；Adapter 不发现安装、不使用 Desktop/ASAR。默认账户 provider 为 deepseek-account，只接受显式 full_access。SDK 注册与配置见 [DSH Adapter](../../../packages/octo-runtime-adapter-dsh/README.md)。

通用 `acp` 是接入其他 ACP Harness 的 Adapter 工厂，不是需要另外安装的 Harness。通过 `createAcpAdapter` 配置命令和参数，并将返回的 Adapter 原生注入 createKernelService；CLI 则由宿主 manifest 选择该工厂；默认 CLI manifest 未注册这个通用类型，见[工厂实现](../../../packages/octo-runtime-adapter-acp/src/index.ts)和 [ACP 文档](https://agentclientprotocol.com/get-started/introduction)。

安装完成后，按 [CLI 安装与调用](../getting-started/cli.md)检查所选 Adapter，并发送一个小任务。Adapter 不能直接执行 shell alias；后台服务也需要正确的 `PATH`、用户目录和账号配置，修改服务环境后需重启服务。

## 开启 Codex Computer Use

1. 在受支持的桌面应用中打开 Codex，进入 **Plugins → Computer Use**，安装或启用插件，并打开 server 和 skill 开关。
2. macOS 按提示授予屏幕录制和辅助功能权限，再运行 **Try now** 检查访问是否正常。

可用区域和平台配置以 [OpenAI Computer Use 官方文档](https://learn.chatgpt.com/docs/computer-use)为准。

接入 Runtime 时，使用相同的操作系统账号和 `CODEX_HOME` 运行宿主进程。[Codex Adapter](../../../packages/octo-runtime-adapter-codex/src/index.ts) 使用真实的该目录启动 `codex app-server`，因此已有 Codex 配置和插件状态仍然可用。Runtime 没有 `computer_use: true` 配置项，`full_access` 也不会安装插件或授予操作系统权限。

上述官方步骤用于开启桌面功能；该安装是否将所需工具提供给当前 CLI/app-server，还需要通过 Runtime 实际调用确认，本文的自动化测试未验证 Computer Use 兼容性。如果调用中没有这些工具，应先检查 Codex 版本、`CODEX_HOME`、插件配置和 app-server 可见工具，再决定是否修改 Runtime MCP 配置。应用还需要处理受支持的审批请求，见[输出与控制](../reference/output-and-control.md)。

## CodeBuddy 共享 WorkBuddy 额度

[WorkBuddy 中国区定价说明](https://www.codebuddy.cn/docs/workbuddy/Pricing)明确说明：CodeBuddy 与 WorkBuddy 同一账号的积分共享。账号套餐还需要包含 CLI 访问权限，桌面端能用不代表 CLI 一定能用。

1. 运行 `codebuddy`，选择与 WorkBuddy 相同的账号和区域服务登录；当前账号不对时，在 CodeBuddy 内使用 `/logout`、`/login` 切换。
2. 通过 `/status` 和账号用量页面核对账号，再在 Runtime 中选择 `codebuddy`。Runtime 使用 Harness 已有的认证，没有单独的“共享额度”开关。

操作方式见 [CodeBuddy 登录指南](https://www.codebuddy.cn/docs/cli/quickstart)和[交互命令](https://www.codebuddy.cn/docs/cli/slash-commands)。如果用量记在其他账户下，按[认证指南](https://www.codebuddy.cn/docs/cli/iam)检查已配置的 API 凭据和服务地址；独立 API Key 或企业服务可能采用其他计费方式。共享账号积分无需复制 WorkBuddy 凭据文件，中国区个人套餐的说明也不代表跨区或企业版权益互通。

Harness 配置链接核对日期为 2026-10-21。安装命令、功能开放范围和账号权益可能变化，更新信息请查看所附官网；Adapter 的实现范围见 [Provider 支持范围](../reference/providers.md)。
