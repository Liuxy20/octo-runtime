# CLI 安装与运维

[English](../../en/getting-started/cli.md) | [文档目录](../README.md)

通过 Runtime CLI 可以安装、启动和运维 Executor Kernel 与可选 Extra，检查 Adapter，并试运行一次 Agent 调用。运行环境使用 Node.js 24.x 或 26.x（LTS）。

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

以上命令安装 npm 上已发布的版本。下文命令要求版本的帮助信息中包含 `executor-kernel`；如果已装版本没有，请使用下面的源码构建方式。

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

`restart` 不自动安装服务；未安装时返回退出码 3。服务被显式禁用后，`start` 和 `restart` 返回 `SERVICE_DISABLED`。先执行 `octo-runtime executor-kernel install --autostart=true` 恢复启用，再执行 `start`。再次普通 `install` 也会恢复自启。只需前台运行时使用 `run`，无需注册系统服务。

使用以下命令管理已注册的服务：

```sh
octo-runtime executor-kernel restart
octo-runtime executor-kernel stop
octo-runtime executor-kernel uninstall
```

全局参数包括 `--home <path>`、`--profile <name>` 和 `--manifest <path>`。操作同一个服务时使用相同的 Home；profile 选择该 Home 内的配置，不会另建一个 Kernel 服务。默认 Home 在 macOS/Linux 上为 `~/.octo-runtime`；Windows 设置了 `LOCALAPPDATA` 时为 `%LOCALAPPDATA%\OctoRuntime`，也可以通过 `OCTO_RUNTIME_HOME` 覆盖。

全局 `--version` / `-v` 输出安装产物的版本、commit 和 build 时间，可放在命令前后，包括 Extra 自有子命令之后；查询不加载模块，也不要求配置可用。放在 `--` 后时仍是字面位置参数。

CLI 从内置清单和 `<Home>/manifest.json` 选择 Adapter 与 Extra，还会发现当前 CLI 同一全局安装环境中的 Extra；优先级为内置 > Home > 全局。声明或发现 Extra 不等于启用或启动。`--manifest` 完整替换这些来源。格式、解析锚点和旧 Extra `module` 字段迁移见 [Adapter 与 Extra 载入](../concepts/module-loading.md)。

## 配置三个内置 Extra

首选 `configure`，无需手动拼 JSON。以下示例替换占位值后使用；业务参数和配置字段同名。

### channel-gateway

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "<BOT_TOKEN>"
```

每次配置一个 Bot，可重复运行：相同 `bot_id` 更新原项（改地址也不追加），新 ID 追加到 `config.bots`；省略字段及其他 Bot 保留。旧 JSON 中跨地址的同 ID 多项会合并为首项，保留首项省略字段。业务参数与配置字段同名，凭据直接传原文。

可选 `--model`、`--effort`（low/medium/high/xhigh）。使用 OpenClaw 时改为 `--adapter_type openclaw`、`--provider_agent_id main`，不传 `--workdir`；从已有本地 Adapter 切换时，通过对应 Extra 的 `extraset` 移除旧 workdir。

### channel-wecom

```sh
octo-runtime channel-wecom configure \
  --bot_id assistant \
  --ws_url wss://openws.work.weixin.qq.com \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "<APP_SECRET>"
```

每次配置一个 Bot，可重复运行：相同 `bot_id` 更新原项（改地址也不追加），新 ID 追加到 `config.bots`；省略字段及其他 Bot 保留。旧 JSON 中跨地址的同 ID 多项会合并为首项，保留首项省略字段。业务参数与配置字段同名，凭据直接传原文。

可选 `--model`、`--effort`（low/medium/high/xhigh）。使用 OpenClaw 时改为 `--adapter_type openclaw`、`--provider_agent_id main`，不传 `--workdir`；从已有本地 Adapter 切换时，通过对应 Extra 的 `extraset` 移除旧 workdir。 `--ws_url` 可省略：更新保留旧地址，新 Bot 使用官方默认地址。

### webui

```sh
octo-runtime webui configure \
  --port 13888
```

`configure` 只接收 `--port`。首次会话文件为 `<home>/extras/webui/sessions.json`，已有路径和项目设置保留；同一 Home 只保存一份 WebUI 配置。自定义路径使用下方进阶 JSON 配置，字段仍为 `sessionStorePath`、`defaultProjectPath`。

### 启动与帮助

配置命令只保存，不自动启动、启用或重载。首次按需启动各组件；已有服务改配置后改用对应的 `restart`。

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

根帮助顶部保留版本、commit 和 build 信息，命令依次优先展示 `executor-kernel`、`channel-gateway`、`channel-wecom`、`webui`，有效目录内的其他命令随后按名称排列。进入 Extra 后，先列公共生命周期和完整 JSON 读写命令，再列插件自有命令；`Usage` 后有独立的 `Examples` 区块。`--home`、`--manifest` 始终是全局参数，配置命令前后均可使用；Extra 配置属于 Home，不接受 `--profile`。完整用法见 [Extra 自有命令](../guides/extra-commands.md)。

### 进阶：手动拼 JSON

进阶用法：通过对应 Extra 的 `extraset/extraget` 子命令读写包含 `config`、可选 `module`/`enabled` 的完整 JSON 声明。业务配置操作以该 Extra 自己声明的子命令为准；内置 Extra 不再提供 `config set/get`。

```sh
octo-runtime channel-gateway extraset \
  < channel-gateway-declaration.json
octo-runtime channel-gateway extraget
```

`extraset` 直接替换整份声明，不按 bot_id 合并，也不保留省略字段。读取命令返回完整对应 JSON（渠道含凭据）。保存后仍需重启已运行的 Extra。

各 Extra 使用各自的配置结构。Octo Gateway 完整声明示例：

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

`model` 和 `effort` 都可省略；省略时使用所选 Harness 框架本身的默认值。示例中的 `<MODEL_ID>` 请替换成该 Harness 支持的模型标识；`effort` 可为 `low`、`medium`、`high` 或 `xhigh`，具体支持范围由 Harness 决定。

WeCom 完整声明示例：

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

`model` 和 `effort` 都可省略；省略时使用所选 Harness 框架本身的默认值。示例中的 `<MODEL_ID>` 请替换成该 Harness 支持的模型标识；`effort` 可为 `low`、`medium`、`high` 或 `xhigh`，具体支持范围由 Harness 决定。

`module` 可省略；提供时必须与有效清单一致。多个 Bot 必须全部写在 `config.bots` 中；`extraset` 不做 configure 的按 ID 更新。POSIX 文件权限为 `0600`。

### Provider 与准入

- Claude Code：把 `adapter_type` 改成 `claude-code`；`model`、`effort` 可省略。
- OpenClaw：用 `{ "adapter_type": "openclaw", "provider_agent_id": "main" }`，不填 `workdir`；Gateway 由 OpenClaw 自己启动。
- 本地 Provider 省略 `workdir` 时使用 `~/octo-runtime/channels/{bot_id}`，与 CLI Home 无关。
- `groups_enabled: false` 关闭群与话题；`group_ids` 省略、`null` 或 `[]` 都表示不加额外范围限制。
- `allowed_sender_ids` 省略表示不加限制；显式名单只允许列出的发送者，`[]` 拒绝全部，`null` 非法。

## Extra 组件与日志

```text
octo-runtime <extra-name> install|start|restart|stop|status|uninstall|logs
```

`<extra-name>` 可以是 `channel-gateway`、`channel-wecom`、`webui`，或有效模块清单/全局发现中的其他名称。这些动作沿用 Kernel 的自启与就绪规则；Extra 可以先于 Kernel 启动，此时报告 Kernel 不可用，Kernel 上线后自动恢复。

```bash
octo-runtime channel-gateway logs --lines 200
octo-runtime channel-gateway logs --follow --json
```

日志只包含组件状态：初始化与关闭、Kernel 可用性、连接与重试计划，不含聊天正文、标识、模型输出或凭据。CLI 同时镜像到 `<Home>/logs/extras/<extra>-status-<UTC小时>.log`，保留当前文件加最近两份归档，每份最多 100 MiB；`logs` 最多读取最近三份中的 4 MiB。

## 诊断与恢复

```bash
octo-runtime executor-kernel logs --lines 200
octo-runtime executor-kernel logs --follow --json
```

Kernel 父进程独立记录 worker 的退出信号/退出码、恢复阶段、错误码、代次和下次重试，
位于 `<Home>/logs/kernel-status-<UTC小时>.log`，沿用上述保留和读取限制，不含执行正文。
SDK 宿主通过 `createKernelService({ logging: { directory } })` 显式选择日志目录。

`service.state=running` 只表示服务进程存在，执行能力以 `runtime.execution_ready` 为准。
worker 退出后自动恢复新请求；清理或 manifest 写入失败按 1/2/5 秒间隔重试，之后最多每
5 秒重试一次。`worker.state=exhausted` 表示当前恢复被阻塞，仍会重试；查看
`worker.recovery` 中的阶段、原因和 `retry_at`。间隔不包含清理及 worker 启动耗时，
持续权限或身份问题可能仍需处理。恢复不重新执行旧请求；确定尚未执行的拒绝与在途执行
失联后的未知结果分别反馈，不要求重启 Channel Gateway。

`status` 分别返回原生 `service` 状态和 IPC `runtime` 状态，退出码 0 不代表业务可用。`doctor` 报告服务管理器探测和服务定义；`adapter list`、`adapter probe` 查询已运行的 Kernel，不会启动它。

返回码：0 成功；2 参数或声明非法；3 组件未安装；4 不可达或未就绪；5 清理不完整；1 其他失败。文本错误写 stderr，JSON 错误写 stdout。

Windows 崩溃后工具树状态未知时，启动会以 `ORPHAN_CLEANUP_INCOMPLETE` 失败。确认遗留进程已停止后再执行：

```bash
octo-runtime doctor --home <home>
octo-runtime executor-kernel recover --acknowledge-orphan-cleanup --home <home>
octo-runtime executor-kernel start --home <home>
```

恢复只确认这一份清单归档，不会终止未知进程，也不会把人工确认报告成已验证清理。

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

地址处理和事件消费见 [SDK 入门](sdk.md)。注册 Kernel 后还需单独配置、启动 `channel-gateway`，才能接入 Octo IM；接入方式见 [Extra 指南](../guides/extras.md)。

## 让 Agent 使用 octo-cli

在 Harness 实际执行工具的机器上安装 `octo-cli`，并确保该进程的 `PATH` 能找到它。通过执行环境提供 Octo 凭据，例如 `OCTO_BOT_TOKEN`，以及需要时的 `OCTO_API_BASE_URL`；逐轮配置方式见[环境变量 Context](../reference/contexts.md)，不要将凭据写入模型文本。

Channel Gateway 会为它发起的调用准备这些业务环境变量。OpenClaw 的工具运行在独立的 Gateway 进程中，需要在该进程中配置环境；CLI 可以向已发现的本地 Gateway 同步所选 OpenClaw bot 的变量，随后需要重启该 Gateway，远端 Gateway 则需自行配置。

`octo-cli` 自己也会选择账号：显式传入 `--profile` 或 `--bot-id` 时，指定的账号优先于环境变量凭据。未显式选择账号时，环境变量凭据优先于隐式选中的已保存 profile，其中 `OCTO_TOKEN` 优先于 `OCTO_BOT_TOKEN`。Agent 使用了错误的 Octo 账号时，应检查实际命令中的选择参数和执行环境。该顺序已对照 [3d39abd 版本的凭据实现](https://github.com/Mininglamp-OSS/octo-cli/blob/3d39abddc64a75de5570ebd0b6548b091c682df5/internal/cmdutil/factory.go)核实，最新命令和配置方式见 [octo-cli 安装与认证指南](https://github.com/Mininglamp-OSS/octo-cli#readme)。

来源：[CLI 帮助](../../../apps/cli/src/help.ts)、[Home 与 profile 路径](../../../apps/cli/src/state.ts)、[OpenClaw 配置](../../../apps/cli/src/openclaw.ts)、[Octo 工具环境](../../../packages/octo-runtime-extra-channel-gateway/src/execution/tool-environment.ts)。
