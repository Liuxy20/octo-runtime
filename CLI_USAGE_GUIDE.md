# Octo Runtime CLI 使用指南

本文描述当前 `feat/executor-kernel-host-lifecycle` 工作区的 CLI 行为。旧 `daemon` 命令组已删除，没有兼容别名；本指南继续作为有效操作文档维护。

Runtime CLI（`octo-runtime`）是 Host SDK 的一个宿主，面向设备部署和运维。CLI 分别管理 Executor Kernel 与 Channel Gateway：Kernel 监督执行 worker，Gateway 在独立进程中处理 Octo IM 连接。两者独立安装、启动、停止和卸载，Gateway 不负责维护或拉起 Kernel。

Electron、Tauri 2 及其他业务宿主使用 [SDK 原生接入指南](SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)，不得通过 CLI 或解析终端输出接入。`octo-cli` 是消息、文档等业务操作工具，与本文的 `octo-runtime` 不是同一程序。

## 1. 安装与准备

要求 Node.js 24.x。Provider 软件及其认证须提前准备；安装 Runtime 包不会安装 Provider 或完成认证。已发布版本可从 npm 安装，具体版本须包含本文命令：

```bash
npm install -g @mininglamp-oss/octo-runtime
octo-runtime --version
octo-runtime --help
```

源码开发使用根目录 `package.json` 指定的 pnpm 版本：

```bash
pnpm install --frozen-lockfile
pnpm build
node apps/cli/dist/index.js --help
```

后续示例使用 Bash/zsh；源码环境可将 `octo-runtime` 替换为 `node apps/cli/dist/index.js`。发行包构建与离线安装验证见 [部署说明](DEPLOYMENTS.md)。

## 2. Home 与 profile

| 参数 | 含义 |
| --- | --- |
| `--home PATH` | 配置、日志、运行状态与组件端点所属的 Home |
| `--profile NAME` | Kernel 启动或 playboard 使用的 Provider 配置；省略时读取 Home 的 `default_profile`，未配置则为 `default` |
| `--manifest PATH` | Kernel 启动或 playboard 使用的 Adapter 清单；省略时使用 CLI 内置清单 |

Home 默认采用 `OCTO_RUNTIME_HOME`；未设置时，Windows 使用 `%LOCALAPPDATA%\OctoRuntime`，其他平台使用 `~/.octo-runtime`。Windows 未设置 `LOCALAPPDATA` 时也回退到用户目录下的 `.octo-runtime`。

每个 Home 有一组 Kernel 与 Gateway 服务。profile 选择 Provider 配置，不额外创建一组服务；服务 ID 和端点按 Home 与组件隔离。Home 不是 Provider 的执行工作目录。

`extraset` / `extraget` 只读写 `<home>/extras/<name>/config.json`，不接受 `--profile`。所有安装、启停和查询操作须选择同一个 Home。以下示例均使用默认 Home；自定义时统一添加 `--home /absolute/runtime-home`。

## 3. 两个组件的生命周期

```text
octo-runtime executor-kernel uninstall|install|start|restart|stop|run
octo-runtime channel-gateway uninstall|install|start|restart|stop|run
```

| 动作 | 行为 |
| --- | --- |
| `install` | 注册本组件原生用户服务；首次默认关闭自启；重复安装省略选项时保留已有自启设置 |
| `install --autostart=true` / `false` | 注册或更新本组件服务，并显式设置自启 |
| `start` / `restart` | 操作已安装的本组件并等待 IPC 就绪；未安装返回 3，不隐式安装或启动另一组件 |
| `stop` | 停止本组件，保留服务定义和自启设置 |
| `uninstall` | 停止并移除本组件服务定义，保留 Home、身份、配置和凭据 |
| `run` | 前台运行本组件；收到 Ctrl+C 或 SIGTERM 后等待清理 |

### 前台运行

先在一个终端启动 Kernel：

```bash
octo-runtime executor-kernel run
```

完成下一节的 Gateway 配置后，在另一个终端启动 Gateway：

```bash
octo-runtime channel-gateway run
```

两个命令均持续运行。退出 Gateway 不会停止 Kernel；退出 Kernel 不会停止 Gateway。Gateway 也可以先启动，此时状态中 `kernel_available=false`，尚不能执行模型任务。不要对同一 Home 的同一组件同时使用前台运行和后台服务启动。

### 后台用户服务

配置好 Gateway 后执行：

```bash
octo-runtime executor-kernel install --autostart=true
octo-runtime executor-kernel start
octo-runtime channel-gateway install --autostart=true
octo-runtime channel-gateway start
octo-runtime status
```

原生服务后端分别使用 macOS LaunchAgent、Linux systemd user service 和 Windows 当前用户 Task Scheduler。服务启动成功仅表示对应组件就绪，不证明 Provider 已认证或所有 Bot 已在线。

停止或卸载时分别操作，例如：

```bash
octo-runtime channel-gateway stop
octo-runtime executor-kernel stop
octo-runtime channel-gateway uninstall
octo-runtime executor-kernel uninstall
```

停止 Gateway 会取消它拥有的执行并清理插件；停止 Kernel 会中断内核中的执行。重启不会恢复或重新提交旧 Run，运维时应选择没有活动任务的时段。

## 4. 配置 Octo IM Gateway

准备 Bot ID、Bot Token、环境 API 地址及已认证的本地 Provider。以下示例的占位值须替换；`workdir` 使用运行机器上的绝对路径：

```bash
octo-runtime extraset channel-gateway <<'JSON'
{
  "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway",
  "config": {
    "bots": [
      {
        "api_url": "https://im-test.deepminer.com.cn/api",
        "bot_id": "<OCTO_BOT_ID>",
        "bot_name": "项目助理",
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
              "payload": {
                "entries": [{ "text": "我是明略科技的Octo助理" }]
              }
            }
          ]
        }
      }
    ]
  }
}
JSON
```

`extraset` 保存完整声明，不连接 Bot、不安装插件，也不自动重启组件。每次整体替换，不按 `bot_id` 合并；多个 Bot 须放入同一个 `config.bots` 数组一起保存。POSIX 配置文件权限为 `0600`。

首次保存后使用上一节的 `run` 或 `install` + `start`。后台 Gateway 已运行时，修改配置后只重启 Gateway：

```bash
octo-runtime channel-gateway restart
octo-runtime status
```

前台 Gateway 则 Ctrl+C 后重新 `run`。无需重启 Kernel；但修改 Kernel 使用的 Provider 连接或 Adapter 清单时，需要单独重启 Kernel。

`octo-runtime extraget channel-gateway` 返回完整配置，包含已保存的凭据，配置路径写入 stderr；不要把它的输出放入公开日志。`extraset` 的保存回执不回显凭据，也不代表插件加载或业务连接成功。

### Provider 与准入配置

- Claude Code：将 `adapter_type` 改为 `claude-code`；`model`、`effort` 可省略，按 Provider 配置执行。
- OpenClaw：将 adapter 改为 `{ "adapter_type": "openclaw", "provider_agent_id": "main" }`，不填写 `workdir`。CLI 在 Kernel 启动时刷新已保存连接来源；首次发现可指定 `OPENCLAW_HOME`。OpenClaw Gateway 须自行启动，Runtime 不代为启动。连接与工具环境的影响见 [OpenClaw 合同](.octospec/rules/openclaw.md)。
- 本地 Provider 的 `workdir` 省略时使用并创建 `~/octo-runtime/channels/{bot_id}`，此路径不随 CLI Home 改变。
- `groups_enabled: false` 关闭群与话题入口；`group_ids` 省略、`null` 或 `[]` 均表示不增加群范围限制。群消息仍须真实 @Bot 并通过发送者权限检查。
- `allowed_sender_ids` 省略时仅允许认证所得 owner；显式名单替代 owner，`[]` 拒绝所有发送者。

全部字段与多 Bot 配置见 [Gateway 配置说明](packages/octo-runtime-extra-channel-gateway/README.md) 和 [配置 Schema](packages/octo-runtime-extra-channel-gateway/config-schema.json)。动态 `loadContexts` 函数由 SDK 宿主注入，不能写入 CLI JSON，见 [SDK Gateway 指南](SDK_CHANNEL_GATEWAY_GUIDE.md)。

## 5. 状态、诊断与日志

```bash
octo-runtime status --json
octo-runtime doctor
octo-runtime adapter list
octo-runtime adapter probe codex
```

`status` 分别返回两个组件的原生 `service` 状态与 IPC `runtime` 状态。Kernel 的 `execution_ready` 表示 worker 就绪；Gateway 的初始化、Kernel 可用性及各 Bot 业务连接状态须分别判断。状态查询成功可以返回组件已停止或不可达，不能仅凭退出码 0 判定业务可用。

`doctor` 返回服务管理器探测、两个服务定义及 IPC 状态，应检查返回字段。`adapter list` / `probe` 查询已运行 Kernel 的 Adapter 元数据，不隐式启动 Kernel，也不执行模型任务；实际执行成功仍须通过真实 Provider 验证。

普通命令输出 JSON；帮助和版本输出文本。命令失败时也须检查非零退出码及 JSON 错误，不能仅检查 stderr。组件日志目录为 `<home>/logs`。当前命令不提供旧 `--quiet`、`--verbose` 或 `--logs-dir` 参数。

常规命令返回码：0 成功；2 参数或声明非法；3 组件未安装；4 不可达或未就绪；5 清理不完整；1 其他失败。错误类别以实际返回为准，`run` 意外退出返回失败；不要在清理未确认时直接替换实例。

## 6. 本地临时执行

`playboard` 是开发诊断入口，独立启动临时 Kernel，不要求预先启动后台服务，不加载 Extra，结束时只回收本次组件。真实 Provider 仍须安装并认证。

```bash
octo-runtime playboard <<'JSON'
{
  "inputs": [{ "type": "text", "text": "Reply OK" }],
  "contexts": { "schema": "octo.context-envelope/v3", "items": [] },
  "protocol_mode": "canonical"
}
JSON
```

stdout 为 NDJSON，诊断写 stderr；`protocol_mode` 省略时为 `native`，可显式选择 `canonical`。需要审批或问答时，该开发入口以 `PLAYBOARD_INTERACTION_REQUIRED` 失败；持续会话与交互使用 SDK。执行输入与默认值见 [InvokeInput 合同](.octospec/rules/invoke-input.md)。

## 7. 旧版弃用与重新安装

`1.0.1` 为旧 daemon 架构的 deprecated 版本，不支持从旧 daemon 升级或迁移到当前架构。已有安装须先卸载 npm 包，再重新安装包含新命令组的版本。

卸载 npm 包前，先用旧版本命令或原生服务管理器停止并移除旧 daemon 服务；`npm uninstall -g` 只卸载包，不会自动停止进程或移除系统服务定义。然后执行：

```bash
npm uninstall -g @mininglamp-oss/octo-runtime
npm install -g @mininglamp-oss/octo-runtime@<NEW_VERSION>
octo-runtime --help
```

`<NEW_VERSION>` 须替换为已发布、包含 `executor-kernel` 与 `channel-gateway` 命令组的新架构版本，不能重新安装 `1.0.1`。本分支尚未发布时，使用第 1 节的源码构建入口验证。

重新安装后按本文重新配置并分别安装、启动两个组件。不提供旧状态、配置或服务定义的迁移流程；卸载 npm 包也不等于删除 Home，勿将遗留文件仍在理解为迁移成功。

新架构版本之间的日常更新见 [部署说明](DEPLOYMENTS.md)。完整命令速查见 [CLI README](apps/cli/README.md)，当前平台验证范围见 [实施记录](.octospec/tasks/executor-kernel-host-lifecycle/implementation.md)。
