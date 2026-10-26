# Cross-platform User Services

[English](README.md) | [包导航](../README.zh.md)

通过当前用户自己的服务管理器安装、启动、停止、检查和删除长期运行进程：macOS 用 launchd，Linux 用 `systemctl --user`，Windows 用任务计划程序。它把同一份 `ServiceSpec` 映射到三种平台。它不跑任何 Agent 回合，也不证明 Kernel IPC、Provider、云端连接或 IM 已经就绪。

## 什么时候用它

- CLI 或安装器要为当前用户留下一个长期运行的服务。
- 你想知道已安装的定义和实际状态之间有没有漂移。
- 把 Kernel 嵌进现有应用时不该用它——直接用服务工厂。

## 各个动作做什么

| 调用                 | 行为                                                                             |
| -------------------- | -------------------------------------------------------------------------------- |
| `probe` / `inspect`  | 报告原生状态、可得的 PID 或退出码、配置漂移。不做修复。                          |
| `install`            | 对齐定义和开机自启，但不会启动已停止的服务。运行中的定义被更新时，按需替换进程。 |
| `enable` / `disable` | 只控制以后是否激活，不启动也不停止当前进程。                                     |
| `start` / `restart`  | 要求服务已安装且已启用。                                                         |
| `stop`               | 保留定义。                                                                       |
| `uninstall`          | 删除定义，保留应用数据。                                                         |

`createServiceBackend(options?)` 只选择当前平台的后端，不安装也不探测。后端就暴露上面这些动作；`ServiceError` 带稳定错误码，测试可以注入 `CommandRunner`。

## 平台限制

- macOS 用每用户 LaunchAgents。
- Linux 用 `systemctl --user`，不开启 linger。
- Windows 用当前用户交互令牌的最小权限任务，登录时激活——不是 LocalSystem 服务。
- Windows 不支持 spec 里的 `environment`、`stdoutPath`、`stderrPath`：应用得自己写日志。它的失败重启延迟至少 60 秒，`always` 会被拒绝。任务 XML 是带 BOM 的 UTF-16LE，所以优先用后端，不要手写序列化。
- 锁屏不等于登出。登录、开机、登出行为取决于原生管理器和 Linux linger 配置；本包不配置管理员策略。

## 输入

用绝对的可执行文件路径和工作目录路径，argv 数组要精确，不做 shell 解释。定义会落盘，所以不要把 token、密码、cookie 或密钥放进参数和环境变量；应用自己加载受保护的凭据。

## 导入与分发

private workspace 的部署辅助包，没有等价的公开 SDK 子路径。写好定义不等于应用就绪：IPC 和应用状态要另外检查。

## 延伸阅读

- [导出](src/index.ts)、[合同](src/types.ts)、[CLI 安装与运维](../../docs/zh-CN/getting-started/cli.md)。
