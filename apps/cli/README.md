# Octo Runtime CLI

CLI 是 Host SDK 的一个宿主，负责自己的 JSON 配置与原生用户服务。桌面或其他 HostApp 使用 SDK 接入。

## 命令

```text
octo-runtime executor-kernel uninstall|install|start|restart|stop|status|run
octo-runtime <extra-name> uninstall|install|start|restart|stop|status|run
octo-runtime status [--json]
octo-runtime doctor
octo-runtime adapter list
octo-runtime adapter probe <type>
octo-runtime extraset <name> < config.json
octo-runtime extraget <name>
octo-runtime playboard < request.json
```

通用参数：`--home PATH`、`--profile NAME`、`--manifest PATH`、`--json`。裸组件命令显示帮助，也可使用 `octo-runtime executor-kernel --help`。Extra 名称可为 channel-gateway、channel-wecom、webui 或 extraset 保存的名称。Extra 配置属于 Home，extraset/extraget 不接受 --profile。

| 动作 | 行为 |
| --- | --- |
| install | 注册并启用本组件的自启服务；首次和重复安装都默认开启自启 |
| install --autostart=true/false | 显式修改本组件自启设置 |
| start | 未安装时自动注册本组件并开启自启，随后启动并等待 IPC 就绪；已安装时保留服务设置 |
| restart | 重启已安装并启用的本组件并等待 IPC 就绪；未安装返回 3 |
| status | 查询本组件的服务、IPC 和公开业务状态 |
| stop | 停止本组件，不改变自启设置 |
| uninstall | 停止并移除本组件服务，保留用户数据 |
| run | 前台启动本组件；SIGINT/SIGTERM 时等待清理 |

CLI 面向普通用户，install 默认完成本组件自启配置，只有显式 --autostart=false 才禁用；再次执行不带该选项的 install 会恢复自启。组件互不隐式启动。channel-gateway 可以在 Kernel 未运行时独立启动，其状态报告 kernel_available=false；业务连接状态与 Kernel 就绪分别报告。Kernel 与每个 Extra 分别执行 install，默认注册各自的自启服务，自动启动不依赖前后顺序；Kernel 后上线不要求重启 Extra。这些是用户服务，在用户登录或用户 manager 激活时自启。

start 自动安装时向 stderr 打印“未安装，正在安装并开启自启”和“安装完成，开始启动”两阶段进度；安装失败不会继续启动。--json 的 stdout 只保留最终 JSON 结果。已有显式禁用服务仍返回 SERVICE_DISABLED，可用 install --autostart=true 恢复。帮助先说明组件用途，再列出配置/启动入口及命令。

start/restart 成功后直接展示与本组件 status 相同的服务、自启、IPC、Manager、PID、Worker/Extra 业务状态及服务定义路径；--json 在 component/action 之外提供与 status 相同的 service/runtime 数据。

Gateway 的 cardDeliveries、Gateway/WeCom 的 deliveries 仅展示当前保留的回执总数，不展开消息明细，也不是累计发送量；内部原有最多 512 条回执的防重机制保持不变。

status/doctor/服务操作默认输出便于阅读的文本，`--json` 输出缩进 JSON。status 仍查询每个已配置 Extra 自身的状态，文本展示业务健康、Bot 与任务等计数，完整公开数据保留在 JSON 中。旧版解析 status JSON 的脚本须添加 --json。extraget 仍输出完整紧凑 JSON，playboard 仍输出 NDJSON。文本错误写 stderr；--json 错误写 stdout，包含稳定错误码、组件、动作和日志位置，均须检查退出码。

服务名包含规范化 Home 的 SHA-256 前 16 位及组件名。POSIX 端点在 Home/sockets 下；Windows 使用 Home hash 命名管道。不同 Home 和组件不共用服务 ID。

## 旧版弃用

`1.0.1` 为旧 daemon 架构的 deprecated 版本，不支持从旧 daemon 升级或迁移。已有安装先停止并移除旧服务，再执行 `npm uninstall -g @mininglamp-oss/octo-runtime`，然后安装已发布的新架构版本并重新配置。npm 卸载不会自动移除旧系统服务或 Home；完整步骤见 [部署说明](../../DEPLOYMENTS.md)。

## Extra 配置

```bash
octo-runtime extraset channel-gateway < gateway.json
octo-runtime channel-gateway restart
octo-runtime extraget channel-gateway
```

gateway.json 是完整声明 `{ "module": "@mininglamp-oss/octo-runtime-extra-channel-gateway", "config": { "bots": [] } }`。每次整份替换，保存文件权限为 POSIX 0600。extraset 不打印凭据；extraget 按显式请求返回完整配置，路径写入 stderr。

## 临时执行

playboard 在当前进程构造临时 Kernel，读取选定 profile 的 Provider 配置。结束时只回收本次组件，不停止常驻服务，不加载 Extra。

```bash
octo-runtime playboard <<'JSON'
{"inputs":[{"type":"text","text":"Reply OK"}],"contexts":{"schema":"octo.context-envelope/v3","items":[]},"protocol_mode":"canonical"}
JSON
```

需要已安装并认证的真实 Provider。输出为 NDJSON，执行诊断写 stderr；待交互请求按开发入口合同明确失败。Provider、模型、权限等通过 Context 的既有执行项设置。

## 返回码

0 成功；2 参数或声明非法；3 未安装组件；4 不可达或未就绪；5 关闭不完整；1 其他失败。status 可成功返回停止状态，不把服务运行等同于 Provider 或云端业务可用。
