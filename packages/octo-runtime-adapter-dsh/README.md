# DeepSeek Harness Adapter

`dsh` 是独立的 canonical Adapter。KernelClient 经 Kernel worker 调用本机已安装的 DeepSeek Harness；不控制 Desktop 窗口，不安装 Provider，不修改用户 profile 或认证文件。

## 支持版本和入口

运行已安装的 Runtime CLI 或 SDK 需要 **Node.js 24.x 或 26.x**，精确范围为 `^24.0.0 || ^26.0.0`；这也是用户运行环境要求，不只是开发或编译环境要求。Node.js 22 不在支持范围内，请先升级到 Node.js 24；“24+”不代表支持任意更高主版本。

macOS Desktop 入口依赖 Node.js 的 [`process.execve`](https://nodejs.org/api/process.html#processexecvefile-args-env)，用于保留官方 Client 拥有的 PID 和 stdio。该 API 仍标记为 Experimental；当前实现保留此依赖，并在 API 不可用时明确失败。Node.js 24/26 有自动化覆盖，本机真实 Desktop 验收使用 Node.js 24；不声明 Node.js 22 兼容性。

直接使用官方 `@deepseek-ai/dsh-sdk-client@0.2.1-rc.3` 的 `HarnessClient`，不自行实现 JSON-RPC Client。该版本是 2026-10-25 查询 npm 得到的最高版本，标签为 `next`；上游 `latest` 标签仍指向旧版，故显式锁定版本。

当前支持同版 `@deepseek-ai/dsh@0.2.1-rc.3`、SDK wire `deepseek-harness-sdk-runtime/0.0.1`。本机验证的 Desktop commit 为 `be72761ee1a6736ebcdf4f3739363b083ae53c98`。升级后版本检查明确失败，需要重新核对原生合同。

默认优先使用 PATH 中的 `dsh`；macOS 找不到时使用 `/Applications/DeepSeek Harness.app` 内嵌的 CLI。官方 Client 用 Node 启动 `dshBin`；Desktop 入口通过 `execve` 保留该进程的 PID/stdio，切换到 Electron 和 asar 内 CLI，不另建协议代理。其他安装位置使用 `desktopPath`。Windows/Linux 可以通过 `dshBin` 显式选择 Node CLI module；本次未验证其真实 DSH 发行版。

先在 Desktop 登录，再以同一操作系统账号启动 Runtime。默认 `profile=sdk`、`provider=deepseek-account`、`model=deepseek-flash`，复用 Provider 自己的凭据解析；API key 路径需显式选择 `deepseek-official` 并由宿主准备。默认不会根据缺少某个环境变量猜测登录状态。

```sh
octo-runtime adapter probe dsh
```

probe 只证明兼容入口可运行，不证明账户、模型或工具可用。真实验证入口：仓库构建后运行 `node scripts/verify-dsh-live.mjs`，会调用模型并在临时工作目录写入验证文件。该脚本是依赖本机已安装且配置完成的 DSH 的手动验收，不作为普通 CI 门禁；CI 使用可控 fixture，不能替代真实 Desktop 验收。

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
| `dshBin` | 自动发现 | 官方 Client 的 Node CLI module 路径；与 command/args/desktopPath 互斥 |
| `command`、`args` | 自动发现 | 保留 Node executable 加单个 CLI module 的旧配置；显式 arg 最多 4096 UTF-8 bytes，超量在探针前拒绝；任意 executable/argv 组合明确拒绝，改用 dshBin |
| `desktopPath` | macOS 默认安装位置 | 绝对 `.app` 路径；当前仅 macOS |
| `profile` | `sdk` | 使用已有 SDK profile；自定义 profile 必须暴露同一 RPC 服务 |
| `dshHome` | Provider 原生默认 | 子进程的 DSH_HOME；宿主负责准备和保护 |
| `provider` | `deepseek-account` | 原生 provider ID |
| `maxTokens` | 原生默认 | 正整数输出上限；model 使用 `agentConfig.model` 或本轮 model Context |
| `initializeTimeoutMs` | 15000 | 握手期限，毫秒 |
| `requestTimeoutMs` | 30000 | 普通 RPC 期限，毫秒 |
| `shutdownTimeoutMs` | 1000 | shutdown 回执期限，毫秒；随后仍确认拥有进程退出 |

`session/wait` 使用本轮 runTimeoutMs，未指定时为 120000 毫秒。版本探针有独立 10000 毫秒期限，也观察取消并回收进程树。原始通知大小由 Protocol 在解码前检查，Adapter 在官方通知回调中同步投影；投影后的 canonical 事件和队列沿 Runtime StreamLimitPolicy 的独立预算。

补丁还限制 SDK 自身的诊断与关系表：未换行 stderr 后缀最多 16384 个 UTF-16 code unit，保留尾部总量最多 65536 UTF-8 bytes；SDK lineage 最多 128 项，身份最长 191 字符。无关会话通知同样消耗 SDK 的关系预算，超量以 STREAM_QUEUE_ITEMS_EXCEEDED 失败；不会用 filter 丢弃来掩盖内存增长。

上游原版 SDK 0.2.1-rc.3 没有解析前行字节上限。本项目通过 `pnpm patchedDependencies` 固定两个可审查补丁：Client 接收本轮字节预算和受管进程清理函数；官方 Protocol 在 StringDecoder、字符串拼接和 JSON.parse 之前逐段计数字节，覆盖响应、通知以及尚无换行的数据。超限以 PROVIDER_MESSAGE_TOO_LARGE 失败并关闭本轮传输。CRLF 中的 CR 计入行预算，LF 分隔符不计入；恰好等于上限仍可接收。补丁随源码及发行包保留，不声称这些扩展已经上游发布。非 JSON 行仍按上游行为忽略，无有效初始化响应最终超时失败。订阅过滤回调返回 false，避免在 SDK 内额外积累通知队列；pending next 只监听订阅失败，不因首条通知完成，关闭会拒绝该等待。

## 输出和限制

原生 prompt 回执只表示入队。成功还需关联 receipt、root turn/end=completed、非空 committed answer、session/wait 成功，以及拥有进程清理完成。只收到 idle、空回答、EOF 或 enqueue ACK 都不会报成功。

DSH 原生事件 seq 用于按会话去重，允许非零起点和向前跳号；相同序号的完全相同事件去重，冲突重复仍报错。执行是否成功由上述完成证据判定，不因原生序号不连续而失败。Runtime HostFrame 的 seq 由 Core 独立生成，与 DSH 原生序号无关。

Provider 兼容原则：Adapter 的强制校验限于正确映射结果、确认执行终态和完成资源清理所需的合同，以及已有资源预算。未映射的原生事件类型忽略，不因内部编号习惯或与结果无关的事件差异中断整轮执行。重复事件去重；但明确的执行失败、传输中断、必要完成证据缺失或相互矛盾、资源超限和清理失败仍须按对应状态处理，不能以兼容为由补造结果或报告成功。DSH seq 不连续本身不是完成证据缺失。

本版 SDK 在消息提交后转发 compact text-chunks，Adapter 重放这些增量并与 committed snapshot 对账；这不是实时逐 token 流。工具参数从原生 JSON 字符串解析，结果使用 toolCallId 关联；单工具失败不替代 root 的终态。Child 仅在发现原生 lineage 后纳入，文本使用 commentary，不混入 root final。原生 reasoning 标记 analysis/private_reasoning 和来源，公共卡片不能展示该内容。usage 只传递已报告的数值，不估算 token。

本版 SDK 没有交互审批传输，因此只接受调用方明确选择的 full_access，原生权限固定为 danger-full-access；ask/assisted 在启动前拒绝。工作目录不是沙箱。非 default actmode、逐轮 MCP 不支持时明确拒绝；effort 没有 setter，沿统一 notice 回执说明未应用。

失败边界沿现有 Adapter SDK / Core 合同：Core 在接纳调用前检查协议和审批模式，拒绝时 invoke 迭代会抛错且不启动 Provider；直接调用 Adapter 的 ask/assisted 同样抛出 APPROVAL_MODE_UNSUPPORTED。Adapter SDK 的协议和逐轮 MCP 合同检查也允许抛错。调用被接纳后，DSH 自身的 actmode、沙箱、启动参数、恢复会话和会话占用校验返回单个 canonical run.failed；其中配置错误使用 DSH_CONFIG_INVALID，actmode 使用 DSH_ACTMODE_UNSUPPORTED。重复会话的拒绝不会释放正在执行的会话占用。Core 对这些 DSH 失败保持 cleanup=complete；已启动进程的失败仍须先确认回收。

恢复后的工作目录须与本轮请求经 realpath 解析为同一目录，符号链接别名可接受；仅返回请求根下的其他子目录仍报 DSH_SESSION_RESUME_FAILED，避免在错误目录执行。大小写别名在支持的文件系统上通过真实目录回归验证，不把字符串统一转小写当成跨平台等价规则。

每轮独占一个官方 HarnessClient；取消调用其 close，不终止 Desktop GUI 或兄弟调用。Client 补丁在 spawn 时建立独立 POSIX 进程组并捕获 Adapter SDK 现有 createProcessCleanup；shutdown 后由同一函数完成 TERM、KILL 和退出确认，父进程已退出也继续回收所属组。只有确认后才输出唯一终态；回收失败保留执行和清理两种原因。Windows 使用现有 taskkill /T 路径，真实 Windows DSH 与父进程先退出后的工具回收尚未验收，不将 POSIX 结果推广到 Windows。Session 文件由 DSH 原生管理，Adapter 不另存业务历史。

失败沿共同 FailureEnvelope：公共 OH 分类码在 `payload.failure.code`，DSH 稳定原因在 `payload.failure.reasonCode` 和顶层兼容 `code`。例如 DSH_SESSION_RESUME_FAILED、DSH_INITIALIZE_TIMEOUT、DSH_REQUEST_TIMEOUT、DSH_TRANSPORT_CLOSED、DSH_TRAJECTORY_INVALID、DSH_EXECUTION_FAILED、DSH_NO_FINAL_OUTPUT、DSH_CANCEL_FAILED、DSH_CLEANUP_FAILED。容量超限保留共同 PROVIDER_MESSAGE_TOO_LARGE / STREAM_QUEUE_* 原因码。Core 日志保留公共码与 reason_code；Adapter 经 invocation context 复用同一日志入口，记录有界阶段、时间、原生安全 code，不记录 prompt、凭据、原生 error.message 或 stderr。官方公共 API 不暴露 PID/request ID，故不读取私有字段或解析其错误文本。独立调用可用 `createDshAdapter({log})` 提供同一受控 RuntimeLog；错误不自动重发模型或工具。

源码声明官方 Client 精确生产依赖。构建发行包时，esbuild 按实际 import 收集应用补丁后的官方 Client 和官方 SDK Protocol 的 JavaScript，保留 workspace 依赖为外部包并记录上游版本、补丁和 MIT 许可。Adapter 始终传入显式 dshBin，因此不使用官方 SDK 自动解析 npm Provider 的默认路径；发行包不携带整套 Provider 或平台原生模块，不在消费者安装时下载 Provider。离线包验证覆盖这条路径。

测试沿仓库的构建产物约定：运行 pnpm test 会先清理并构建当前源码，再执行测试；CI 的 pnpm typecheck 同样先构建，随后运行 pnpm test:suites。内部 trajectory 测试读取本轮构建产物，不作为公共 API 导出；官方 Client 测试通过包名解析其公开入口，不依赖 node_modules 内部布局。单独执行 node --test 前需先运行 pnpm build。

解析前预算依赖上述两个下游补丁，不对解析后的通知重复 JSON.stringify 再套用原始预算：科学计数法等表示在重新序列化后可能变长，但不代表原始帧超量。源码安装使用 pnpm install --frozen-lockfile 应用锁定补丁；Protocol 边界测试检查超量数据在 JSON.parse 调用前被拒绝。发行验证对离线安装后的公共 Adapter 再执行超大响应、分段帧、无换行数据和合法数字表示展开测试，并核对随包补丁与仓库字节一致；macOS、Linux 和 Windows CI 都执行该发行验证。

源码依赖图包含官方 Client 声明的同版 Provider 依赖，因此 lockfile 明显增大。默认 CLI 内置 DSH，暂不改成可选 Adapter 安装；消费者发行包只收集实际使用的 Client/Protocol JavaScript，不携带该 Provider 依赖图。构建脚本禁止误收集 Provider，离线验证检查发行主包不声明官方 Provider/Client npm 依赖；不能通过手工裁剪 lockfile 减少这部分源码依赖。
