# CLI 安装与运维

[English](../../en/getting-started/cli.md)

## Codex 常驻 Engine

默认配置由 CLI 服务进程创建 managed owner，再把 provider 注入 Adapter，无需新增必填配置。CODEX_HOME 由该宿主选择：工厂 options.codexHome、服务进程 CODEX_HOME、最后 ~/.codex。服务进程环境与发起 start 的短命客户端环境须分别配置。首次调用启动 app-server；同一 owner 的全部调用复用该进程。stop 和正常 Playboard 结束由 CLI 停止恢复、关闭 Kernel、回收 owned Engine，保留 Home 数据。

CLI 默认纳管的同类型 Harness 只有一个实例，Codex 的不同工作目录、任务与并发调用共享一个 app-server。doctor 的 Resident processes (ownership) 树在 CLI Host 下平级显示 Kernel（in-process，共用 PID）与 app-server；后者显示 owned、状态与 incarnation。Adapter 只引用 Engine，不是 PID 树节点。status/doctor 读取宿主快照，不启动 Engine。Electron 自管 Engine 归 Electron，不套用 CLI 默认托管策略。

```sh
npm install -g @mininglamp-oss/octo-runtime
octo-runtime start
octo-runtime doctor
octo-runtime status
octo-runtime adapter list
octo-runtime adapter probe codex
octo-runtime logs --lines 200 --follow
octo-runtime stop
octo-runtime uninstall
```

支持 Node.js 24/26。start 未安装时自动安装，install 默认开启自启；--autostart=false 关闭自启。restart 不安装缺失服务。stop/uninstall 保留 Home、身份、配置和日志。

通过 --home、--profile 和 --manifest 选择 CLI 自己的环境。--json 输出机器可读结果。

渠道使用 [octo-channel-gateway](https://github.com/Mininglamp-OSS/octo-channel-gateway) 自己的 CLI 和 Home，并指定已启动 Kernel 的 endpoint。

通过 `playboard` 提交 Agent 请求时，在发送 stdin JSON 前准备好工作目录。本地请求必须显式提供 仅含 path 的 workspace item，例如 `{ "namespace": "octo.execution", "name": "workspace", "payload": { "path": "/absolute/prepared/project" } }`。CLI 与 SDK 都要求已存在的绝对路径，不默认取命令的 cwd，也不创建应用目录。`run` 启动 Kernel 服务，不选择 Agent 工作区。OpenClaw 使用 Provider 自有工作区，可以省略本地覆盖。见[工作目录校验与迁移](../reference/invoke-input.md)。

生命周期命令直接位于顶层：`install`、`uninstall`、`start`、`stop`、`restart`、`run`、`status`、`logs`、`recover`。前台运行使用 `octo-runtime run`，参数说明使用 `octo-runtime <命令> --help`。`recover` 只能在确认 doctor 报告的遗留工具已停止后，带 `--acknowledge-orphan-cleanup` 执行。

旧的 `octo-runtime executor-kernel <命令>` 语法已删除，调用脚本需改用顶层命令。升级已有系统服务后，使用相同 `--home`（以及原先显式指定的 `--profile` / `--manifest`）依次执行 `octo-runtime stop`、`octo-runtime install`、`octo-runtime start`；install 将系统服务启动参数刷新为 `run`。如需保持禁止自启，install 时继续传 `--autostart=false`。服务身份、Home 和配置保留。`status --json` 继续返回 `executor-kernel` 状态键；Kernel SDK 包路径和 IPC 端点名称不变。
