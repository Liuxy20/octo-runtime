# WebUI Extra

[English](README.md) | [包导航](../README.zh.md)

可选的 `webui` Extra，提供一个本地浏览器工作台：托管界面、调用已有 Kernel、通过 SSE 把源事件推到浏览器。它拥有自己的 HTTP 监听、内置静态资源和一份显式配置的 session JSON 文件。它是调试面，不是生产应用，也从不启动第二个执行器。

## 什么时候用它

- 你想在本机浏览器里试一个正在跑的 Kernel。
- 你需要快速查看会话、Adapter、目录和流式输出。
- 你在做真正的产品：用 SDK，不用这个。

## CLI 常用命令

先替换占位值并配置，再按需启动独立服务：

```sh
octo-runtime webui configure \
  --port 13888
```

`configure` 只接收 `--port`。首次会话文件为 `<home>/extras/webui/sessions.json`，已有路径和项目设置保留；同一 Home 只保存一份 WebUI 配置。自定义路径使用下方进阶 JSON 配置，字段仍为 `sessionStorePath`、`defaultProjectPath`。

```sh
octo-runtime webui start
octo-runtime webui status
octo-runtime webui restart
octo-runtime webui stop
octo-runtime webui configure \
  --help
```

配置只保存文件，不自动启动或重载。首次使用 `start`；已运行服务修改配置后用 `restart`。执行 Agent 任务还需单独启动 `executor-kernel`。

## 托管它

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import * as webui from "@mininglamp-oss/octo-runtime/extras/webui";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";

export async function startWebUI(endpoint: string, config: JsonObject) {
  const extra = createExtraService({ endpoint, module: webui, config, dependencies: {} });
  await extra.initialize();
  return extra;
}
```

宿主侧不需要 React：浏览器资源已经预构建在 `dist/web`。

## 进阶：JSON 配置与 SDK 字段

进阶用法：手动编写业务 JSON（不含外壳）时，用 `config set/get`；手动管理含 `config`、可选 `module`/`enabled` 的整份声明时，用 `extraset/extraget`。

```sh
octo-runtime webui config set \
  < webui-business.json
octo-runtime webui config get

octo-runtime extraset webui \
  < webui-declaration.json
octo-runtime extraget webui
```

`config set` 经业务校验后替换全部业务配置，保留宿主字段；`extraset` 直接替换整份声明，不保留省略字段。读取命令返回完整对应 JSON。保存后仍需重启已运行的 Extra。

| 字段                 | 说明                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `port`               | 默认 `13888`。监听地址固定 `127.0.0.1`。                                      |
| `sessionStorePath`   | SDK/手写 JSON 必填且为绝对路径；CLI configure 首次自动推导。                           |
| `defaultProjectPath` | 默认 `~/octo-runtime-workspace`。项目是服务机器上的真实目录，不是浏览器上传。 |
| `context`            | 按 namespace/name 与每次请求的 Context 合并；请求项会整项替换配置项。         |

CLI 会把这些字段包成 `{ "module": "@mininglamp-oss/octo-runtime-extra-webui", "enabled": true, "config": { ... } }`；SDK 只传 `config`。完整声明见 [config-schema.json](config-schema.json)。通常使用上方 `configure` 自动生成声明；手动拼 JSON 时再使用 `extraset`。

## 会话

JSON 文件是 `{ version: 1, sessions: [...] }`，上限 100 个会话、32 MiB，按最近最少使用淘汰。不透明的 Provider 绑定会保留；UI 会话 ID 本身不是 Provider 绑定。写入是原子的，POSIX `0600`，按 revision 串行，并做损坏校验。删除会话只移除 WebUI 记录并取消它的在途工作，不删项目文件、不删原生 Provider 会话、不动 Runtime 身份。项目选择、草稿、模型 ID 这类纯 UI 设置放在浏览器 `sessionStorage`。

## HTTP 边界

- 页面 cookie 加 Host 校验，写操作再做同源与 token 校验；不开 CORS。
- 最多 4 个活动调用，每个会话 1 个。
- SSE 走 pipeline 背压；断开或页面卸载会把取消转发下去。
- 路由覆盖 bootstrap、adapters、directories、sessions、invoke、cancel、respond。
- 没有终态的 SSE EOF 表示断开，不表示完成，也不会自动重发模型请求。

## 状态

`status()` 返回 `{ listening, host, port, activeRequests, errors }`。`loaded` 本身不证明监听成功，端口或配置错误会一直可见。停掉 WebUI 不影响 Kernel 和其他 Extra。

## 验证

构建该包，跑它的 `test:ui`，再跑 `node --test test/webui-extra.test.js`。Fake Provider 的 UI 检查不能当作真实 Provider 的证据。

## 导入与分发

发行入口：`@mininglamp-oss/octo-runtime/extras/webui`。

## 延伸阅读

- [实现](src/index.ts)、[移植对照](porting-map.md)、[UI 测试](web/test)、[Host SDK](../octo-runtime-host-sdk/README.zh.md)。
