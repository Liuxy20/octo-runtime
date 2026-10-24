# DeepSeek Harness Adapter

`dsh` 是独立的 canonical Adapter。KernelClient 经 Kernel worker 调用本机已安装的 DeepSeek Harness；不控制 Desktop 窗口，不安装 Provider，不修改用户 profile 或认证文件。

## 支持版本和入口

当前固定支持 `@deepseek-ai/dsh@0.2.1-rc.3`、SDK wire `deepseek-harness-sdk-runtime/0.0.1`。本机验证的 Desktop commit 为 `be72761ee1a6736ebcdf4f3739363b083ae53c98`。升级后版本检查明确失败，需要重新核对原生合同。

默认优先使用 PATH 中的 `dsh`；macOS 找不到时使用 `/Applications/DeepSeek Harness.app` 内嵌的 CLI。Desktop 通过其 Electron executable、`ELECTRON_RUN_AS_NODE=1` 和 asar 内 CLI 路径运行，以保留原生模块解析。其他安装位置使用 `desktopPath`。Windows/Linux 可以显式选择 executable；本次未验证其真实 DSH 发行版，Windows 回收边界仍跟踪 #14。

先在 Desktop 登录，再以同一操作系统账号启动 Runtime。默认 `profile=sdk`、`provider=deepseek-account`、`model=deepseek-flash`，复用 Provider 自己的凭据解析；API key 路径需显式选择 `deepseek-official` 并由宿主准备。默认不会根据缺少某个环境变量猜测登录状态。

```sh
octo-runtime adapter probe dsh
```

probe 只证明兼容入口可运行，不证明账户、模型或工具可用。真实验证入口：仓库构建后运行 `node scripts/verify-dsh-live.mjs`，会调用模型并在临时工作目录写入验证文件。

## SDK 与 CLI

主发行包导出 `@mininglamp-oss/octo-runtime/adapters/dsh`。宿主维护的独立 worker 文件：

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime/executor-kernel";
import { dshAdapter } from "@mininglamp-oss/octo-runtime/adapters/dsh";
serveWorker([dshAdapter]);
```

宿主在本进程构造 `createKernelService({endpoint, workerEntrypoint})`，业务调用 `kernel.client.invoke(input)`；完整所有权示例见 [原生服务指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。不需要 SDK manifest。CLI 内置 manifest 已注册 `dsh`；Gateway 只需设置 `adapter.adapter_type="dsh"`，保持已有 DM/群授权、卡片和会话管理链路。

本轮请求必须显式使用 canonical 和 full_access：

```json
{
  "inputs": [{ "type": "text", "text": "Reply OK" }],
  "protocol_mode": "canonical",
  "contexts": {
    "schema": "octo.context-envelope/v3",
    "items": [
      { "namespace": "octo.execution", "name": "adapter", "payload": { "type": "dsh" } },
      { "namespace": "octo.execution", "name": "workspace", "payload": { "mode": "fixed", "path": "/absolute/project" } },
      { "namespace": "octo.security", "name": "approval_policy", "payload": { "mode": "full_access" } }
    ]
  }
}
```

调用方保存真实 `session.update.payload.providerSession`，续聊原样传回。Adapter 先原生 resume，再设置本轮工作目录，最后发送本轮输入；恢复失败不会另建会话。可信 controlInstructions 只在新会话中作为独立 user text block 发送，不冒充原生 system prompt。普通业务 Context 每轮由 Core 渲染，不从 Provider 历史补齐。

执行参数位于 `agentConfig.providerOptions`；CLI profile 中使用 `adapters.dsh.execution.provider_options`，其值须为字符串。SDK 的 `args` 仅支持字符串数组，CLI 字符串配置不支持该数组。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `command`、`args` | 自动发现 | executable 与独立 argv；禁止 shell 拼接。args 需要 command；command 与 desktopPath 互斥 |
| `desktopPath` | macOS 默认安装位置 | 绝对 `.app` 路径；当前仅 macOS |
| `profile` | `sdk` | 使用已有 SDK profile；自定义 profile 必须暴露同一 RPC 服务 |
| `dshHome` | Provider 原生默认 | 子进程的 DSH_HOME；宿主负责准备和保护 |
| `provider` | `deepseek-account` | 原生 provider ID |
| `maxTokens` | 原生默认 | 正整数输出上限；model 使用 `agentConfig.model` 或本轮 model Context |
| `initializeTimeoutMs` | 15000 | 握手期限，毫秒 |
| `requestTimeoutMs` | 30000 | 普通 RPC 期限，毫秒 |
| `shutdownTimeoutMs` | 1000 | shutdown 回执期限，毫秒；随后仍确认拥有进程退出 |

`session/wait` 使用本轮 runTimeoutMs，未指定时为 120000 毫秒。版本探针有独立 10000 毫秒期限，也观察取消并回收进程树。协议行、队列复用 Runtime 的 StreamLimitPolicy，不是整个进程 RSS 保证。

## 输出和限制

原生 prompt 回执只表示入队。成功还需关联 receipt、root turn/end=completed、非空 committed answer、session/wait 成功，以及拥有进程清理完成。只收到 idle、空回答、EOF 或 enqueue ACK 都不会报成功。

本版 SDK 在消息提交后转发 compact text-chunks，Adapter 重放这些增量并与 committed snapshot 对账；这不是实时逐 token 流。工具参数从原生 JSON 字符串解析，结果使用 toolCallId 关联；单工具失败不替代 root 的终态。Child 仅在发现原生 lineage 后纳入，文本使用 commentary，不混入 root final。原生 reasoning 标记 analysis/private_reasoning 和来源，公共卡片不能展示该内容。usage 只传递已报告的数值，不估算 token。

本版 SDK 没有交互审批传输，因此只接受调用方明确选择的 full_access，原生权限固定为 danger-full-access；ask/assisted 在启动前拒绝。工作目录不是沙箱。非 default actmode、逐轮 MCP 不支持时明确拒绝；effort 没有 setter，沿统一 notice 回执说明未应用。

每轮独占一个子进程；取消关闭拥有进程组，不终止 Desktop GUI 或兄弟调用。正常关闭先请求 shutdown，再做有界 TERM/KILL 清理；确认回收后才输出唯一终态。Session 文件由 DSH 原生管理，Adapter 不另存业务历史。

失败沿共同 FailureEnvelope：公共 OH 分类码在 `payload.failure.code`，DSH 稳定原因在 `payload.failure.reasonCode` 和顶层兼容 `code`。例如 DSH_SESSION_RESUME_FAILED、DSH_INITIALIZE_TIMEOUT、DSH_REQUEST_TIMEOUT、DSH_TRANSPORT_CLOSED、DSH_TRAJECTORY_INVALID、DSH_EXECUTION_FAILED、DSH_NO_FINAL_OUTPUT、DSH_CANCEL_FAILED、DSH_CLEANUP_FAILED。容量超限保留共同 PROVIDER_MESSAGE_TOO_LARGE / STREAM_QUEUE_* 原因码。Core 日志保留公共码与 reason_code；Adapter 经 invocation context 复用同一日志入口，记录有界 state、request_id、native_code、pid、exit_code、signal（可得时），不记录 prompt、凭据、原生 error.message 或 stderr。独立调用可用 `createDshAdapter({log})` 提供同一受控 RuntimeLog sink；原生数值/枚举诊断不会进入公共卡片。错误不自动重发模型或工具。

本包直接实现固定版本的原生 JSON-RPC Client，复用 Runtime 的有界 reader、队列和清理实现。官方 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3` 强制依赖完整 Provider；引入它会使 Runtime 安装时携带 Provider，故不作为生产依赖。
