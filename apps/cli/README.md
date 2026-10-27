# Octo Runtime CLI

CLI 是 Host SDK 的一个宿主，负责自己的 JSON 配置与原生用户服务。桌面或其他 HostApp 使用 SDK 接入。

模块由 CLI 内置 `manifest.json` 与所选 Home 的 `manifest.json` 合并选择，均含 `adapters` 和 `extras`。默认发行全量；未启动 Extra 不导入，清单不保存业务凭据或启用设置。条目以原始清单文件为解析锚点，同名内置优先；Extra 还可从当前 CLI 同一 npm/pnpm 全局安装环境自动发现，优先级为内置 > Home > 全局；显式 `--manifest` 完整替换所有默认来源。SDK 原生 import，不读取这些文件。双语说明见 [English](../../docs/en/concepts/module-loading.md) / [简体中文](../../docs/zh-CN/concepts/module-loading.md)。

## 命令

```text
octo-runtime executor-kernel uninstall|install|start|restart|stop|status|run
octo-runtime <extra-name> uninstall|install|start|restart|stop|status|run
octo-runtime status [--json]
octo-runtime doctor
octo-runtime adapter list
octo-runtime adapter probe <type>
octo-runtime <extra-name> configure [options]
octo-runtime <extra-name> config get
octo-runtime playboard < request.json
```

通用参数：`--home PATH`、`--profile NAME`、`--manifest PATH`、`--json`。裸组件命令显示帮助，也可使用 `octo-runtime executor-kernel --help`。Extra 名称可为 channel-gateway、channel-wecom、webui 或有效模块清单/全局发现中的其他名称。Extra 配置属于 Home，extraset/extraget 不接受 --profile。

| 动作                           | 行为                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| install                        | 注册并启用本组件的自启服务；首次和重复安装都默认开启自启                        |
| install --autostart=true/false | 显式修改本组件自启设置                                                          |
| start                          | 未安装时自动注册本组件并开启自启，随后启动并等待 IPC 就绪；已安装时保留服务设置 |
| restart                        | 重启已安装并启用的本组件并等待 IPC 就绪；未安装返回 3                           |
| status                         | 查询本组件的服务、IPC 和公开业务状态                                            |
| stop                           | 停止本组件，不改变自启设置                                                      |
| uninstall                      | 停止并移除本组件服务，保留用户数据                                              |
| run                            | 前台启动本组件；SIGINT/SIGTERM 时等待清理                                       |

CLI 面向普通用户，install 默认完成本组件自启配置，只有显式 --autostart=false 才禁用；再次执行不带该选项的 install 会恢复自启。组件互不隐式启动。channel-gateway 可以在 Kernel 未运行时独立启动，其状态报告 kernel_available=false；业务连接状态与 Kernel 就绪分别报告。Kernel 与每个 Extra 分别执行 install，默认注册各自的自启服务，自动启动不依赖前后顺序；Kernel 后上线不要求重启 Extra。这些是用户服务，在用户登录或用户 manager 激活时自启。

start 自动安装时向 stderr 打印“未安装，正在安装并开启自启”和“安装完成，开始启动”两阶段进度；安装失败不会继续启动。--json 的 stdout 只保留最终 JSON 结果。已有显式禁用服务仍返回 SERVICE_DISABLED，可用 install --autostart=true 恢复。帮助先说明组件用途，再列出配置/启动入口及命令。

start/restart 成功后直接展示与本组件 status 相同的服务、自启、IPC、Manager、PID、Worker/Extra 业务状态及服务定义路径；--json 在 component/action 之外提供与 status 相同的 service/runtime 数据。

Gateway 的 cardDeliveries、Gateway/WeCom 的 deliveries 仅展示当前保留的回执总数，不展开消息明细，也不是累计发送量；内部原有最多 512 条回执的防重机制保持不变。

status/doctor/服务操作默认输出便于阅读的文本，`--json` 输出缩进 JSON。status 仍查询每个已配置 Extra 自身的状态，文本展示业务健康、Bot 与任务等计数，完整公开数据保留在 JSON 中。旧版解析 status JSON 的脚本须添加 --json。extraget 仍输出完整紧凑 JSON，playboard 仍输出 NDJSON。文本错误写 stderr；--json 错误写 stdout，包含稳定错误码、组件、动作和日志位置，均须检查退出码。

服务名包含规范化 Home 的 SHA-256 前 16 位及组件名。POSIX 端点在 Home/sockets 下；Windows 使用 Home hash 命名管道。不同 Home 和组件不共用服务 ID。

## Extra 配置（常用）

核心配置直接使用参数，无需拼 JSON：

```sh
octo-runtime channel-gateway configure \
  --bot_id assistant \
  --api_url https://im.example.com/api \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --bf_token "<BOT_TOKEN>"

octo-runtime channel-wecom configure \
  --bot_id assistant \
  --ws_url wss://openws.work.weixin.qq.com \
  --adapter_type codex \
  --workdir /absolute/workspace \
  --app_secret "<APP_SECRET>"

octo-runtime webui configure \
  --port 13888
```

Gateway/WeCom 每次配置一个 Bot：同 bot_id 更新，新 ID 追加到 config.bots，省略字段和其他 Bot 保留；改变地址不新增同 ID。WeCom 省略 ws_url 时更新保留旧地址，新 Bot 使用官方默认。WebUI 只暴露 port，首次会话文件为 `<home>/extras/webui/sessions.json`，已有路径保留。

渠道另支持 `--model`、`--effort`；OpenClaw 使用 `--adapter_type openclaw --provider_agent_id main`，不传 workdir。配置保存不自动启用、启动或重载；首次用 start，已运行服务改配置后用 restart。

```sh
octo-runtime channel-gateway start
octo-runtime channel-wecom start
octo-runtime webui start
```

根 `-h` 列出 Extra 名称，`<extra> -h` 查看命令，`<extra> configure -h` 查看参数。全局 --home/--manifest 可放在自有命令前后，不属于 Extra 业务参数。详细说明见 [Extra 自有命令](../../docs/zh-CN/guides/extra-commands.md)。

## 进阶：手动拼 JSON

进阶用法：手动编写业务 JSON（不含外壳）时，用 `config set/get`；手动管理含 `config`、可选 `module`/`enabled` 的整份声明时，用 `extraset/extraget`。

```sh
octo-runtime channel-gateway config set \
  < channel-gateway-business.json
octo-runtime channel-gateway config get

octo-runtime extraset channel-gateway \
  < channel-gateway-declaration.json
octo-runtime extraget channel-gateway
```

`config set` 经业务校验后替换全部业务配置，保留宿主字段；`extraset` 直接替换整份声明，不按 bot_id 合并，也不保留省略字段。读取命令返回完整对应 JSON（渠道含凭据）。保存后仍需重启已运行的 Extra。

`channel-gateway-business.json` 是业务对象，例如 `{ "bots": [] }`；`channel-gateway-declaration.json` 包含外壳，例如 `{ "config": { "bots": [] } }`。把名称换为 channel-wecom/webui 即可管理对应 Extra。模块通常由 manifest 提供；手写 module 时须与有效清单一致。配置文件保存为 POSIX 0600。

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
