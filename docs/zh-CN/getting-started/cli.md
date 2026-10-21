# CLI 安装与调用

[English](../../en/getting-started/cli.md) | [文档目录](../README.md)

通过 Runtime CLI 可以启动 Executor Kernel、检查 Adapter，并试运行一次 Agent 调用。运行环境使用 Node.js 24.x。

## 需要安装哪些程序

| 程序                         | 用途                                                 | 何时需要                        |
| ---------------------------- | ---------------------------------------------------- | ------------------------------- |
| `octo-runtime`               | 启动和管理 Runtime 服务，同时包含 SDK 和内置 Adapter | 从终端运行 Runtime 时           |
| `octo-cli`                   | 调用 Octo 的消息、文档、Drive、Loop 等业务 API       | Agent 需要使用这些 Octo 工具时  |
| `codex`、`claude` 等 Harness | 运行 Agent、调用模型并执行工具                       | 安装所选 Adapter 对应的 Harness |

分别安装 Runtime 和 Octo 业务 CLI：

```sh
npm install -g @mininglamp-oss/octo-runtime
npm install -g @mininglamp-oss/octo-cli
octo-runtime --version
octo-runtime --help
octo-cli --help
```

以上命令安装 npm 上已发布的版本。2026-10-21 核对时，Runtime 的 `latest` 仍为旧 daemon 架构的 `1.0.1`；下文命令要求版本的帮助信息中包含 `executor-kernel`，新版本发布前请使用下面的源码构建方式。替换已有 daemon 安装前，先查看[部署说明](../../../DEPLOYMENTS.md)。

在本仓库中使用 `package.json` 声明的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
```

使用源码构建时，在仓库根目录执行后续命令，并将 `octo-runtime` 替换为 `node apps/cli/dist/index.js`。安装 Runtime 后，还需安装并登录所选 Harness，见 [Harness 安装配置](../guides/harnesses.md)。

## 启动 Executor Kernel

首次本地运行可以使用前台模式：

```sh
octo-runtime executor-kernel run
```

保持该终端运行，在另一个终端检查 Kernel：

```sh
octo-runtime status --json
octo-runtime adapter list
octo-runtime adapter probe codex
octo-runtime doctor
```

将 `codex` 换成准备使用的 Adapter 类型。probe 成功表示通过了该 Adapter 实现的探测，不代表账号额度、模型权限或所有工具都可用；还需要通过一次小任务确认实际执行。

需要由操作系统管理后台服务时，先停止前台进程，再注册并启动服务：

```sh
octo-runtime executor-kernel install
octo-runtime executor-kernel start
```

`install` 注册所选服务，首次和重复安装均默认开启自启，只有显式 `--autostart=false` 才禁用。`start` 在未安装时自动安装本组件并向 stderr 输出进度；已安装时保留设置。`start` 和 `restart` 成功后包含组件状态。状态默认易读文本，`--json` 输出格式化机器数据。macOS 使用 launchd，Linux 使用 systemd 用户服务，Windows 使用任务计划程序。Kernel 与各 Extra 独立自启，不要求启动顺序。

使用以下命令管理已注册的服务：

```sh
octo-runtime executor-kernel restart
octo-runtime executor-kernel stop
octo-runtime executor-kernel uninstall
```

全局参数包括 `--home <path>`、`--profile <name>` 和 `--manifest <path>`。操作同一个服务时使用相同的 Home；profile 选择该 Home 内的配置，不会另建一个 Kernel 服务。默认 Home 在 macOS/Linux 上为 `~/.octo-runtime`；Windows 设置了 `LOCALAPPDATA` 时为 `%LOCALAPPDATA%\OctoRuntime`，也可以通过 `OCTO_RUNTIME_HOME` 覆盖。

## 试运行一次调用

创建 `request.json`，内容如下：

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

通过 CLI 执行：

```sh
octo-runtime playboard < request.json
```

`playboard` 为这次请求启动临时 Kernel，不会将请求提交给常驻服务。stdout 输出 NDJSON 事件，stderr 输出诊断信息，且不加载 Extra。遇到需要回复的交互时，会以 `PLAYBOARD_INTERACTION_REQUIRED` 结束；应用需要回答审批或追问时，应使用 SDK。

修改 `payload.type` 可以选择其他已安装的 Harness。OpenClaw 还需要指定 `provider_agent_id`，例如 `main`；OpenCode 当前要求审批模式为 `full_access`，工具执行无需逐项审批，选择前请查看 [Provider 支持范围](../reference/providers.md)。

从源码仓库调用常驻 Kernel 时，可以使用共享的 SDK 示例，传入实际的 socket 或 Named Pipe 地址：

```sh
node docs/examples/attach.mts /absolute/path/to/kernel.sock codex
```

地址处理和事件消费见 [SDK 入门](sdk.md)。注册 Kernel 后还需单独配置、启动 `channel-gateway`，才能接入 Octo IM；见 [Extra 指南](../guides/extras.md)和[完整 CLI 运维指南](../../../CLI_USAGE_GUIDE.md)。

## 让 Agent 使用 octo-cli

在 Harness 实际执行工具的机器上安装 `octo-cli`，并确保该进程的 `PATH` 能找到它。通过执行环境提供 Octo 凭据，例如 `OCTO_BOT_TOKEN`，以及需要时的 `OCTO_API_BASE_URL`；逐轮配置方式见[环境变量 Context](../reference/contexts.md)，不要将凭据写入模型文本。

Channel Gateway 会为它发起的调用准备这些业务环境变量。OpenClaw 的工具运行在独立的 Gateway 进程中，需要在该进程中配置环境；CLI 可以向已发现的本地 Gateway 同步所选 OpenClaw bot 的变量，随后需要重启该 Gateway，远端 Gateway 则需自行配置。

`octo-cli` 自己也会选择账号：显式传入 `--profile` 或 `--bot-id` 时，指定的账号优先于环境变量凭据。未显式选择账号时，环境变量凭据优先于隐式选中的已保存 profile，其中 `OCTO_TOKEN` 优先于 `OCTO_BOT_TOKEN`。Agent 使用了错误的 Octo 账号时，应检查实际命令中的选择参数和执行环境。该顺序已对照 [3d39abd 版本的凭据实现](https://github.com/Mininglamp-OSS/octo-cli/blob/3d39abddc64a75de5570ebd0b6548b091c682df5/internal/cmdutil/factory.go)核实，最新命令和配置方式见 [octo-cli 安装与认证指南](https://github.com/Mininglamp-OSS/octo-cli#readme)。

来源：[CLI 帮助](../../../apps/cli/src/help.ts)、[Home 与 profile 路径](../../../apps/cli/src/state.ts)、[OpenClaw 配置](../../../apps/cli/src/openclaw.ts)、[Octo 工具环境](../../../packages/octo-runtime-extra-channel-gateway/src/execution/tool-environment.ts)。
