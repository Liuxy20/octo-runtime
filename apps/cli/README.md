# Octo Runtime CLI

CLI 是 Host SDK 的一个宿主，负责自己的 JSON 配置与原生用户服务。桌面或其他 HostApp 使用 SDK 接入。

## 命令

```text
octo-runtime executor-kernel uninstall|install|start|restart|stop|run
octo-runtime channel-gateway uninstall|install|start|restart|stop|run
octo-runtime status [--json]
octo-runtime doctor
octo-runtime adapter list
octo-runtime adapter probe <type>
octo-runtime extraset <name> < config.json
octo-runtime extraget <name>
octo-runtime playboard < request.json
```

通用参数：`--home PATH`、`--profile NAME`、`--manifest PATH`。Extra 配置属于 Home，extraset/extraget 不接受 --profile。

| 动作 | 行为 |
| --- | --- |
| install | 注册本组件服务；首次默认不自启；重复安装省略选项时保留已有自启状态 |
| install --autostart=true/false | 显式修改本组件自启设置 |
| start / restart | 只操作已安装的本组件，等待其 IPC 就绪 |
| stop | 停止本组件，不改变自启设置 |
| uninstall | 停止并移除本组件服务，保留用户数据 |
| run | 前台启动本组件；SIGINT/SIGTERM 时等待清理 |

组件互不隐式启动。channel-gateway 可以在 Kernel 未运行时独立启动，其状态报告 kernel_available=false；业务连接状态与 Kernel 就绪分别报告。

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
