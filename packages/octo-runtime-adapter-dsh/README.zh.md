# DeepSeek Harness Adapter

[English](README.md) | [包导航](../README.zh.md)

通过 DeepSeek Harness 官方 Client SDK 和 stdio 服务跑一轮调用：启动或续接一个显式原生会话，送入本轮输入，把轨迹映射成 `CanonicalEvent`。这是唯一带公开入口的 Adapter：`@mininglamp-oss/octo-runtime/adapters/dsh`。它封装的是未经修改的上游 SDK，所以这项集成按实验性对待，不构成稳定性承诺。

## 什么时候用它

- 安装 **`0.2.1-rc.4` 或更高版本**的 Node 发行版，例如 `npm install -g @deepseek-ai/dsh@0.2.1-rc.4`。通过 `dsh --version` 确认实际版本，npm 的 `latest` 标签可能仍指向较旧版本。宿主维护该安装包 JS 入口的绝对路径，通过 `providerOptions.dshBin` 传入，并准备 DSH 认证。
- Node.js 是 `^24` 或 `^26`——不是任意更高的主版本。
- 你接受下面列出的上游限制。

## 注册 Adapter 并准备输入

以下节选负责注册与输入准备。实际执行使用 `executor.invoke(input)`；完整的消费、终态判断和 `shutdown()` 示例见 [Executor Core](../octo-runtime-executor-core/README.zh.md)。

```ts
import { AgentExecutor } from "@mininglamp-oss/octo-runtime/executor-core";
import { InvokeInput } from "@mininglamp-oss/octo-runtime/protocol";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";

const executor = new AgentExecutor();
executor.register(dshAdapter);

const input = InvokeInput.check({
  agentConfig: { providerOptions: { dshBin: hostSelectedDshEntry } },
  inputs: [{ type: "text", text: "Say hello." }],
  protocol_mode: "canonical",
  approvalMode: "full_access",
  contexts: {
    schema: "octo.context-envelope/v3",
    items: [{ namespace: "octo.execution", name: "adapter", payload: { type: "dsh" } }]
  }
});
```

## 绑定了什么

| 项           | 值                                                                                  |
| ------------ | ----------------------------------------------------------------------------------- |
| Adapter 类型 | `dsh`                                                                               |
| 导出         | `dshAdapter`、`createDshAdapter`                                                    |
| 公开入口     | `@mininglamp-oss/octo-runtime/adapters/dsh`                                         |
| 可执行文件   | 必填：宿主选择的 JS 入口绝对路径 `dshBin`，通过 `process.execPath` 启动 |
| 输出         | 仅 canonical 事件                                                                   |
| 审批         | 只支持 `full_access`                                                                |
| 默认值       | profile `sdk`、provider `deepseek-account`、model `deepseek-flash`                  |

## 兼容性

未修改的官方 Client 仍固定为 `0.2.1-rc.3`；宿主选择的 DSH Provider 要求 **`>=0.2.1-rc.4`**，不设置版本上限。按 SemVer 优先级比较，允许后续预发布版本，build metadata 不影响准入。旧版本或无法解析的版本返回 `DSH_VERSION_UNSUPPORTED`（`OH-ADP-3005`），消息包含检测版本（或 `unknown`）、最低版本和升级提示。`probe()` 返回实际安装版本。`DSH_MIN_VERSION` 表示最低版本，原有 `DSH_VERSION` 导出作为其别名保留。

初始化检查 `deepseek-harness-sdk-runtime` 服务身份和响应结构，不再要求 `serverInfo.version` 精确等于 `0.0.1`。版本检查通过不代表执行成功；真实 SDK、协议及最终消息转换错误仍明确失败。此策略接受未来可能的兼容问题，不预先拒绝更高版本。

Adapter 不发现 npm 安装、不搜索 PATH、不使用 Desktop/ASAR 代码。`command`、`args`、`desktopPath` 均拒绝；配置缺失或非法返回 `DSH_CONFIG_INVALID`，所选文件不存在返回 `DSH_EXECUTABLE_NOT_FOUND`。

上述 `hostSelectedDshEntry` 由宿主管理，例如所选全局 `@deepseek-ai/dsh` 安装内的 `lib/bin.js` 绝对路径。不能传 `dsh.cmd`、`npx.cmd`、Desktop 可执行文件或相对路径。Kernel 宿主在 `createKernelService` 设置 `adapterConfigurations: { dsh: { providerOptions: { dshBin: hostSelectedDshEntry } } }`，使 `kernel.client.list()` 与调用使用同一入口。Runtime CLI 宿主通过 `<home>/<profile>/config.json` 的 `adapters.dsh.execution.provider_options.dshBin` 配置；不会自动迁移既有配置。

Electron 宿主使用自带 runtime executable，无需另装 Node。Adapter 检测到 Electron 时仅在子进程环境中固定 `ELECTRON_RUN_AS_NODE=1`；宿主也须为 Kernel worker 开启 Node mode，且所选 Electron 构建须支持此模式。Windows 同样传入 JS 入口，不使用 shell wrapper。SDK profile 为 `sdk`；无需 Desktop 窗口或已有 Desktop 进程。

DSH 本身还有原生 runtime 兼容要求。此前本地 macOS arm64 实测中，DSH `0.2.1-rc.3` 的 `--version` 成功，但 SDK 初始化以 `unsupported Electron runtime fingerprint` 拒绝 Electron `39.8.10`。此上游拒绝与安装发现不同，单独开启 Node mode 不会使该 Electron 构建兼容。同一历史验证在 Electron `44.7.0`（Node `24.21.0`）通过，不代表更高 DSH 版本已验证兼容。

## 会话与限制

- 显式会话**先续接**，再更新工作目录、发送本轮输入。续接失败不会悄悄新开一个会话。
- 新会话的控制指令是独立的用户文本块，不是原生 system prompt。不重建任何应用历史。
- 上游在预解析输入、stderr、session map 上没有 Runtime 追加的内存边界；上游的 close 只确认直接子进程，不覆盖所有工具后代。Kernel worker 隔离去不掉这些限制。
- 用宿主自己的 API key 时要显式选 `deepseek-official`。环境变量缺失从来不作为原生登录状态的判断依据。

## 验证

`OCTO_DSH_NATIVE_BIN=/absolute/path/to/lib/bin.js node --test test/dsh-native.test.js` 显式验证真实 npm 安装的版本与 SDK 初始化，不发模型请求。这是可选的非门禁验证；fixture 通过不能代替原生平台验证。

`OCTO_DSH_NATIVE_BIN=/absolute/path/to/lib/bin.js node scripts/verify-dsh-live.mjs` 会调用配置好的真实 Provider 并写出验证文件；它是可选的，不在 CI 里跑。发行物打包的是官方 Client 与 Protocol 的 JavaScript，不含 Provider 安装和原生二进制，也没有下游 SDK 补丁。

## 延伸阅读

- [实现](src/index.ts)、[Adapter SDK](../octo-runtime-adapter-sdk/README.zh.md)、[Runtime 公共协议](../octo-runtime-protocol/README.zh.md)。
- [SDK 入门](../../docs/zh-CN/getting-started/sdk.md)、[上游限制](https://github.com/deepseek-ai/deepseek-harness/discussions/11031)。
