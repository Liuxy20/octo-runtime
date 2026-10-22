# @mininglamp-oss/octo-runtime-adapter-grok-build

`grok-build` 复用现有 `octo-runtime-acp-client` 的标准 RPC，每轮启动
`grok --no-auto-update agent --no-leader stdio`。Grok CLI 拥有模型调用、原生工具和会话；
Runtime 不调用 xAI 模型 API，也不嵌入 Grok 源码。支持 canonical，调用方必须显式选择
`protocol_mode: "canonical"`。

ACP 认证握手、会话配置、原生追问和取消策略均在 `grok-build` 包内；通用 ACP client、adapter 与 SDK
审批桥保持现有实现。每次调用独立持有子进程、RPC 队列、交互和取消状态，不修改全局环境或
其他 adapter 实例。宿主仍负责为 bot 传入正确的工作目录和显式 provider session。

## 安装与认证

宿主或使用者按 [Grok Build 官方文档](https://docs.x.ai/build/overview)安装 CLI，
为 Runtime 的操作系统账号准备可直接使用的 harness。登录、授权、凭据来源、存储与刷新由宿主及
harness 负责；Runtime 不要求或检测指定认证环境变量。固定验证版本为
`grok 1.0.67 (2fe064390d07)`；适配器接受兼容的 `>=1.0.67, <2.0.0`，其他版本未实测。

```bash
pnpm cli adapter probe grok-build
```

probe 仅检查命令与版本。invoke 使用 ACP `initialize` → `authenticate` →
`session/new` 或 `session/load` → `session/prompt`。只使用已广告的 `xai.api_key` 或
`cached_token` 非交互握手，按 harness 广告顺序选择，不根据环境变量推断认证状态。
harness 自行解析并验证已有认证材料；真实拒绝如实失败，不自动尝试其他认证方式。
不自动打开浏览器登录、不读取或修改认证文件及持久配置。
`--no-leader` 保持每次调用的进程和环境独立，`--no-auto-update` 避免执行中升级。

## 参数与限制

| 输入 | ACP 映射 |
| --- | --- |
| workdir、环境 | 子进程 cwd/env；会话 cwd 使用相同目录 |
| 本轮文本、图片 | 标准 prompt content；图片要求握手广告 image 支持 |
| controlInstructions | 新会话 `_meta.rules`，保留 Grok 原生系统提示；恢复不重复注入 |
| model | session 发布的 model config option；无有效 setter 时失败 |
| effort | reasoning_effort config option，检查切换模型后的选项；xhigh 可降至 high 并报告警告，其他不支持值报告未应用 |
| actmode | 显式 default/plan 使用 session/set_mode；省略不主动重置 |
| ask / full_access | `_meta.yoloMode=false/true`，autoMode=false；assisted 明确拒绝 |
| sandbox | 不支持逐轮显式覆盖，传入时拒绝；工作目录和审批模式不等于操作系统隔离 |
| MCP | 标准会话 mcpServers，stdio 与广告支持的 HTTP；不支持可选扩展字段；最终含 `${` 的值拒绝，避免原生二次模板展开 |
| providerSession | 显式 session/load，禁用工作区快照恢复；仅 FS_NOT_FOUND 触发既有 fresh fallback，使用宿主提供的恢复输入 |

审批经标准 `session/request_permission`；原生 `_x.ai/ask_user_question` 和
`_x.ai/exit_plan_mode` 转成 canonical question，回复回到同一进程同一请求。full_access
不会自动回答问题或批准计划。计划交互支持批准、放弃、取消；未提供原生计划修改及访谈跳过动作。
未知 reverse request 返回协议错误。取消失效待答交互、发送 session/cancel，并有界回收进程。

标准 `session/update` 转成文本、思考与工具事件；prompt 匹配响应提供结束与用量。
无最终正文、排队 ACK、断流、进程退出和清理失败均不报告成功。Host 在清理完成后发布唯一终态。

## 源码 SDK 注册

CLI 默认清单已包含此模块。源码/submodule 宿主在独立 worker 入口直接注册：

```ts
import { serveWorker } from "@mininglamp-oss/octo-runtime-executor-kernel";
import { grokBuildAdapter } from "@mininglamp-oss/octo-runtime-adapter-grok-build";

// 宿主编译此入口，并将其作为原生 Kernel 的 workerEntrypoint。
serveWorker([grokBuildAdapter]);
```

可编译入口见 [examples/worker.mts](examples/worker.mts)。不要求 SDK 读取 CLI manifest。原生服务托管见 [SDK 指南](../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md)。
此包为 private workspace 模块，不单独发布；CLI 主发行包包含它。

## 验证入口

fixture：`node --test test/grok-build-adapter.test.js`。真实只读流与跨进程续聊：
`node scripts/verify-grok-build.mjs`，使用当前 Grok 账号及网络，不审批工具。
固定版本、资料来源、已验证事实及未验平台见 [Issue 95 reference](../../.octospec/tasks/95-grok-build-acp/reference.md)。
