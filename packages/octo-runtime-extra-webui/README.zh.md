# WebUI Extra

[English](README.md) | [包导航](../README.zh.md)

可选的 `webui` Extra，提供一个本地浏览器工作台：托管界面、调用已有 Kernel、通过 SSE 把源事件推到浏览器。它拥有自己的 HTTP 监听、内置静态资源和一份显式配置的 session JSON 文件。它是调试面，不是生产应用，也从不启动第二个执行器。

## 什么时候用它

- 你想在本机浏览器里试一个正在跑的 Kernel。
- 你需要快速查看会话、Adapter、目录和流式输出。
- 你在做真正的产品：用 SDK，不用这个。

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

## 配置

| 字段                 | 说明                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `port`               | 默认 `13888`。监听地址固定 `127.0.0.1`。                                      |
| `sessionStorePath`   | 必填且为绝对路径。这是 Extra 唯一拥有的 JSON 文件。                           |
| `defaultProjectPath` | 默认 `~/octo-runtime-workspace`。项目是服务机器上的真实目录，不是浏览器上传。 |
| `context`            | 按 namespace/name 与每次请求的 Context 合并；请求项会整项替换配置项。         |

CLI 会把这些字段包成 `{ "module": "@mininglamp-oss/octo-runtime-extra-webui", "enabled": true, "config": { ... } }`；SDK 只传 `config`。完整声明见 [config-schema.json](config-schema.json)。用 `octo-runtime extraset webui` 保存声明，再用 `octo-runtime webui start` 启动独立服务；改配置后执行 `octo-runtime webui restart`。

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
