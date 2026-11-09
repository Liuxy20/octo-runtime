# CLI 安装与运维

[English](../../en/getting-started/cli.md)

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

生命周期命令直接位于顶层：`install`、`uninstall`、`start`、`stop`、`restart`、`run`、`status`、`logs`、`recover`。前台运行使用 `octo-runtime run`，参数说明使用 `octo-runtime <命令> --help`。`recover` 只能在确认 doctor 报告的遗留工具已停止后，带 `--acknowledge-orphan-cleanup` 执行。

旧的 `octo-runtime executor-kernel <命令>` 语法已删除，调用脚本需改用顶层命令。升级已有系统服务后，使用相同 `--home`（以及原先显式指定的 `--profile` / `--manifest`）依次执行 `octo-runtime stop`、`octo-runtime install`、`octo-runtime start`；install 将系统服务启动参数刷新为 `run`。如需保持禁止自启，install 时继续传 `--autostart=false`。服务身份、Home 和配置保留。`status --json` 继续返回 `executor-kernel` 状态键；Kernel SDK 包路径和 IPC 端点名称不变。
