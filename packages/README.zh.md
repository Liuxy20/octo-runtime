# Runtime 包与分层

[English](README.md) | [开发者文档](../docs/zh-CN/README.md)

Octo Runtime 是一套与 Provider 无关的执行实现，SDK 应用、内置 CLI 和可选业务接入共用它。宿主决定 Adapter、配置和 Extra。Executor Core 里的 `AgentExecutor` 干活；Executor Kernel 在同一宿主进程内负责本地 RPC、Run 接纳、观察、控制和有界回放；Host SDK 负责把可选 Extra 装配在周围。

这个目录放的是 private workspace 包。每个包的 README 说明用途、接入入口和边界；Core 与 Kernel 提供执行示例，Adapter 页面展示注册与输入准备。

## 从哪里开始

| 你想…                  | 从这里看                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 在 Electron 或 Node 应用中原生接入 Runtime | [Executor Kernel](octo-runtime-executor-kernel/README.zh.md)                                                                   |
| 显式使用低层执行原语 | [Executor Core](octo-runtime-executor-core/README.zh.md)                                                               |
| 接某个 Provider 的 CLI | 下面的 Provider 表                                                                                                         |
| 写一个新的 Adapter     | [Adapter SDK](octo-runtime-adapter-sdk/README.zh.md)，再读 [ACP Adapter](octo-runtime-adapter-acp/README.zh.md)            |
| 接 Octo IM 或企业微信  | [Channel Gateway](octo-runtime-extra-channel-gateway/README.zh.md)、[WeCom](octo-runtime-extra-channel-wecom/README.zh.md) |
| 把 Extra 装配进应用    | [Host SDK](octo-runtime-host-sdk/README.zh.md)                                                                             |
| 装一个用户级后台服务   | [Cross-platform User Services](octo-runtime-cross-service/README.zh.md)                                                    |

典型链路：

```text
应用或 Extra
  -> KernelClient -> 本地 IPC
  -> ExecutorKernel / HostRunService
  -> Kernel 宿主内的 AgentExecutor -> 已注入的 Adapter -> Provider
```

原生 SDK 宿主 import 并构造 Adapter，将对象交给 `createKernelService({ home, endpoint, adapters })`，初始化后使用 `kernel.client`。即使同进程，业务调用也经过真实本地 RPC。Electron 宿主可在主进程创建 Kernel 和可选 Extra；CLI 通过相同工厂部署独立服务宿主。裸 Core 是显式低层 API，不是普通同进程 SDK 接入入口。

## 协议

| 包                                                          | 作用                                                                          | 注意                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| [octo-runtime-protocol](octo-runtime-protocol/README.zh.md) | `InvokeInput`、Context v3、`CanonicalEvent`、`HostFrame`、JSON Schema、校验器 | 它是词汇表，不是引擎：不调 Provider，也不存历史 |

## Adapter 基础设施

| 包                                                                | 作用                                                              | 注意                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| [octo-runtime-adapter-sdk](octo-runtime-adapter-sdk/README.zh.md) | `Adapter` 接口、`defineAdapter`、子进程/队列/审批/环境与 MCP 工具 | 拿到的是准备好的 `InvokeRequest`，不是公开的 `InvokeInput` |
| [octo-runtime-acp-client](octo-runtime-acp-client/README.zh.md)   | NDJSON 上的 ACP JSON-RPC：请求关联、update 队列、权限、取消       | 它不产出 `CanonicalEvent`，那是 Adapter 的事               |
| [octo-runtime-adapter-acp](octo-runtime-adapter-acp/README.zh.md) | 把任何 ACP CLI 变成完整 Adapter                                   | 仅 canonical；`assisted` 被拒绝                            |

## Provider Adapter

| Provider         | 包                                                                                | 传输                                    | 备注                                                    |
| ---------------- | --------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| Codex            | [octo-runtime-adapter-codex](octo-runtime-adapter-codex/README.zh.md)             | `codex app-server` JSON-RPC stdio       | native 与 canonical；审批和提问回到调用方               |
| Claude Code      | [octo-runtime-adapter-claude-code](octo-runtime-adapter-claude-code/README.zh.md) | `claude` stream-json stdio              | native 与 canonical；`can_use_tool` 交互                |
| CodeBuddy        | [octo-runtime-adapter-codebuddy](octo-runtime-adapter-codebuddy/README.zh.md)     | ACP stdio                               | canonical；不支持图片和 MCP                             |
| OpenCode         | [octo-runtime-adapter-opencode](octo-runtime-adapter-opencode/README.zh.md)       | `full_access` 用 JSON CLI，`ask` 用 ACP | canonical；要求 `>=2.1.3 <3`                            |
| DeepSeek Harness | [octo-runtime-adapter-dsh](octo-runtime-adapter-dsh/README.zh.md)                 | 官方 Client SDK over stdio              | canonical；只支持 `full_access`；唯一公开导出的 Adapter |
| OpenClaw         | [octo-runtime-adapter-openclaw](octo-runtime-adapter-openclaw/README.zh.md)       | Gateway WebSocket RPC                   | canonical；调用远端已有 Agent                           |
| Grok Build       | [octo-runtime-adapter-grok-build](octo-runtime-adapter-grok-build/README.zh.md)   | ACP stdio，自带认证协商                 | canonical；`>=1.0.67 <2`                                |
| Antigravity      | [octo-runtime-adapter-antigravity](octo-runtime-adapter-antigravity/README.zh.md) | `agy` stream-json stdio                 | canonical；只支持 `full_access`                         |
| Hermes           | [octo-runtime-adapter-hermes](octo-runtime-adapter-hermes/README.zh.md)           | `hermes acp`                            | canonical；空 load 结果视为会话丢失                     |
| Kimi Code        | [octo-runtime-adapter-kimi-code](octo-runtime-adapter-kimi-code/README.zh.md)     | `kimi acp`                              | canonical；模型来自广告的 `configOptions`               |
| MCode            | [octo-runtime-adapter-mcode](octo-runtime-adapter-mcode/README.zh.md)             | `mcode acp`                             | canonical；MiniMax 自己选模                             |
| Qoder CLI        | [octo-runtime-adapter-qodercli](octo-runtime-adapter-qodercli/README.zh.md)       | `qodercli --acp`                        | canonical；只有 `full_access` 才加 `--yolo`             |
| Qoder CLI CN     | [octo-runtime-adapter-qoderclicn](octo-runtime-adapter-qoderclicn/README.zh.md)   | `qoderclicn --acp`                      | canonical；独立二进制与 Adapter 类型                    |

宿主 import 并构造 Adapter 实例，Kernel 在本进程注册这些对象，不序列化其方法或依赖。CLI 宿主负责 manifest 解析、动态 import、工厂调用和配置加载。Kernel 不接收模块 manifest，不启动执行 worker。Adapter 可以启动 Provider 子进程，并负责其清理。每个 Adapter 的 README 写了它自己的 Provider 前提和验证边界；出现在这张表里，不代表它的某个功能或平台通过了真实联调。

## 执行器

| 包                                                                        | 作用                                                                        | 注意                                 |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------ |
| [octo-runtime-executor-core](octo-runtime-executor-core/README.zh.md)     | 唯一的 `AgentExecutor`：输入准备、渲染、输出校验、取消、清理                | 共用宿主事件循环和故障域             |
| [octo-runtime-executor-kernel](octo-runtime-executor-kernel/README.zh.md) | `createKernelService`、`KernelClient`、本地 JSON-RPC、Run 接纳与控制、有界回放 | 不回放被打断的 Run，也不持有业务历史 |

Kernel 在宿主进程使用唯一 Core 实现。Kernel、Core 和注入的 Adapter 共用宿主事件循环、内存和故障域：RPC 不能隔离同步阻塞、`process.exit()`、OOM 或宿主崩溃。宿主重启由应用或 CLI 负责；重建会产生新的 Kernel 实例，不重新执行此前已接纳的 Run。重连只能回放原存活实例仍保留的事件；有界回放窗口不是持久历史。

## Extra

| 包                                                                                    | 作用                                                       | 注意                                        |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| [octo-runtime-extra-channel-gateway](octo-runtime-extra-channel-gateway/README.zh.md) | Octo IM 机器人：凭据、悟空 WebSocket、会话、流式回复、文件 | 需要已有 Kernel 端点；从不构造或关闭 Kernel |
| [octo-runtime-extra-channel-wecom](octo-runtime-extra-channel-wecom/README.zh.md)     | 独立的企业微信机器人，自己的连接和生命周期                 | CLI 的 `channel-gateway` 服务不加载它       |
| [octo-runtime-extra-webui](octo-runtime-extra-webui/README.zh.md)                     | 本地浏览器工作台及其 HTTP/SSE 接口                         | 调试界面，不是生产应用                      |

Extra 自己拥有业务行为和外部连接。执行通过 `ctx.kernel` 进来，清理通过 `ctx.onDispose` 注册。加载哪些 Extra 由宿主决定——包括一个都不加载。

## 宿主装配与部署

| 包                                                                    | 作用                                                                   | 注意                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| [octo-runtime-host-sdk](octo-runtime-host-sdk/README.zh.md)           | `createExtraService`、Extra 生命周期、宿主函数注入、Home/身份/端点工具 | 不实现执行，也不替 Extra 启动 Kernel  |
| [octo-runtime-cross-service](octo-runtime-cross-service/README.zh.md) | launchd、systemd、Windows 任务计划程序的用户服务操作                   | 写好定义不代表 Provider 或 IPC 已就绪 |

Host SDK 依赖 Kernel；Core 和 Kernel 不依赖 Host SDK。本地执行不需要登录，也不需要云端登记。

## private 包与公开入口

这个目录下的都是 private `@mininglamp-oss/octo-runtime-*` workspace 包。源码和子模块宿主通过 workspace 依赖它们。npm 使用者安装 `@mininglamp-oss/octo-runtime`，然后用它的公开子路径：

| 源码包                               | 公开入口                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `octo-runtime-protocol`              | `/protocol`，以及 `/protocol/schema.json`                                                                    |
| `octo-runtime-executor-core`         | `/executor-core`：`AgentExecutor`                                                                            |
| `octo-runtime-executor-kernel`       | `/executor-kernel`：`attachKernel`、`createKernelService`、`/executor-kernel/ipc-schema.json` |
| `octo-runtime-host-sdk`              | `/host`：`createExtraService`、`componentEndpoint`；`/extra`：插件类型                                       |
| `octo-runtime-adapter-dsh`           | `/adapters/dsh`：`dshAdapter`、`createDshAdapter`                                                            |
| `octo-runtime-extra-channel-gateway` | `/extras/channel-gateway`                                                                                    |
| `octo-runtime-extra-channel-wecom`   | `/extras/channel-wecom`                                                                                      |
| `octo-runtime-extra-webui`           | `/extras/webui`                                                                                              |

不是所有 workspace 导出都是公开的。比如 workspace 里的 Home 和身份工具目前没有从 `/host` 再导出，除 DSH 外的 Adapter 也没有公开子路径。SDK 的模块选择走原生 import，不需要 CLI manifest。

宿主负责安装、配置、凭据、每轮 Context、历史和存储。调用接纳、取消回执、执行完成、业务投递和资源回收是不同的事件。

## 接下来

- [SDK 入门](../docs/zh-CN/getting-started/sdk.md)、[架构](../docs/zh-CN/concepts/architecture.md)、[模块加载](../docs/zh-CN/concepts/module-loading.md)。
- [Kernel IPC 参考](../docs/zh-CN/reference/kernel-ipc.md)、[输入参考](../docs/zh-CN/reference/invoke-input.md)。
