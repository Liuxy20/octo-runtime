---
type: Rule
title: Octo Runtime 基础架构
description: 执行基础设施与独立业务仓库的责任边界。
tags: [architecture, runtime, adapter, context, installation]
timestamp: 2026-11-04T14:40:00+08:00
id: runtime-architecture
tier: repo
priority: 100
load_bearing: true
inject_when:
  paths: ["apps/**", "packages/**", "config/**", "*.md", ".octospec/**"]
  touches: [architecture, runtime, adapter, context, installation]
source: self
supersedes: []
---

# Octo Runtime 基础架构

Issue 328 取代 Extra 插件及双模式装配方案。Runtime 只保留协议、独立 client、Executor Core/Kernel、Host SDK、Provider Adapter 与 Runtime CLI。独立 Gateway 不属于 Runtime workspace 或发行物；WebUI、WeCom、native 目录和通用 Extra 定义移除。

## SDK 原生装配与统一 RPC

SDK 宿主原生 import Adapter 对象，调用 `createKernelService({home, endpoint, adapters})`。Kernel 不接收 manifest 或业务定义。消费执行能力使用公开 KernelClient.invoke；SDK Desktop App 不通过外部 CLI 启动服务。AgentExecutor 是唯一执行实现。

### 常驻 Engine 所有权细化（Issue 339）

2026-11-09 Issue 339 已按用户授权实施，不保留兼容层。createCodexAdapter({engine}) 只接收 CodexEngineProvider；宿主显式 createManagedCodexEngine({codexHome}) 或注入业务 provider。旧单例、默认导出和进程构造参数删除；实施与验收见 [Issue 339 简报](../tasks/339-engine-lifecycle/brief.md)。

- Adapter 注册统一执行合同，不转移 Engine、共享连接或 Home 的所有权。协议适配不承载默认进程托管决策；Core scope 可以拥有调用路由、订阅和 lease，但不得因此销毁业务自管 Engine。
- CLI 在实际服务宿主进程显式装配默认 Codex 托管 owner，协调启动、恢复、失败回滚和关闭；短命 start 客户端不持有 owner。Electron 宿主通过同一 SDK 原生装配并注入访问依赖，不通过 CLI 启动。
- 常驻 Engine 的启停/恢复归其 owner；每调用 channel/lease 的释放归 Adapter；Home 位置、目录准备、访问权限及数据保留/迁移/删除归 Home owner。三者可以由不同主体维护，引用关系不赋予管理权。
- CODEX_HOME 必须由宿主显式注入 Engine 装配；CLI 可以在宿主层保留默认选择，Adapter/托管库不隐式 fallback、创建、改权限、迁移或清空 Home。进程退出不意味着 Home 生命周期结束；逐轮配置不得偷偷替换宿主绑定的 Home。
- Runtime 不得限制 Adapter 的构造方法、参数数量/类型/顺序或注入形式；类、任意签名工厂、闭包及直接对象均可。可传 client 或任意其他依赖，不要求 client-only、统一 options、Engine 基类或 Codex provider 接口；只约束构造结果的注册执行合同。CLI manifest 工厂约定不得反向成为 SDK 构造限制。不新增统一 Engine 注册平台。Codex 专用访问合同从同一 owner 的唯一服务获取本调用 channel，配置随 thread/turn 传递、不参与进程选择；协议转换共用，owned/borrowed 关闭权分开。
- 本次是架构边界细化，聚焦常驻进程 Adapter。docs 必须同步维护模块职责、持有对象、创建/关闭主体、借用范围和失败收尾；未实施目标与当前保证分别说明。详见[模块与生命周期方案](../tasks/339-engine-lifecycle/design.md)及[双语架构入口](../../docs/zh-CN/concepts/architecture.md)。

doctor PID 树的常驻 Engine 归实际宿主 owner_pid，不归 Adapter。Kernel 的 serviceProcesses 是宿主安全快照回调，仅用于只读诊断，不转移启停权限；Core.processes 仅报告 scope 自有资源。CLI 管理默认 owner，Electron 自管 Engine 则由 Electron 维护。

### CLI 默认同类型 Harness 单实例（Issue 343）

CLI 默认纳管的通用 Harness 按类型只有一个 owner/实例，不因 cwd、任务命令、模型、环境、MCP、容量或并发数量拆分进程池。装配在已声明类型重复时先于工厂调用拒绝；未声明类型的动态工厂在结果校验时拒绝并回滚。这个通用宿主合同不要求 SDK 自管 Adapter 实现统一 Engine 基类，也不改变其他 Adapter 既有逐轮子进程模型。

Codex managed owner 只监督一个 app-server，多 Agent 使用不同 thread/turn 并发复用。启动不显式指定 spawn cwd，自然继承宿主目录，不能把 CODEX_HOME 数据目录当成启动 cwd；argv/环境由 owner 固定。业务工作目录由本轮 thread/start、thread/resume 和 turn/start RPC 传入，shell/MCP 环境、HTTP headers 和容量随本轮配置传递。旧 codexServiceRevision 逐轮分池请求明确拒绝；原地更改账户或启动配置须由宿主关闭并重建 owner。仅账户等明确强隔离需求允许宿主显式装配多个 owner，不能从请求差异推断隔离需求。

并发接纳和资源配额由宿主决定。owner 不设置 Agent 数量、估算 lease 内存、累计 thread 数或交互总数配额，不新增资源预算配置。只保留当前执行的临时 RPC/thread/turn 路由，释放时删除，不保存已结束 thread 历史或业务 session 映射；清理未确认时保留原归属事实。未知 thread 的早到通知仅在待决 thread/start 期间暂存，最后一个 start 结算后释放仍无法关联的通知并拒绝孤立反向请求。既有传输队列与单条消息限制继续执行，不同调用的流限额在路由后分别执行。故障恢复回收旧代再替换，不重放已接纳动作。doctor 显示 CLI Host 拥有平级的 Kernel（in-process，共用 PID）与 app-server，不制造不存在的 Kernel 进程。任务和实际证据见 [343 简报](../tasks/343-single-harness/brief.md)。

### 执行依赖选择归宿主（Issue 346）

2026-11-09 用户确认：既然 Engine 生命周期归宿主，Provider executable、安装来源和执行环境也由宿主选择并注入。该原则统一适用于 Codex app-server、OpenCode 和 ACP command；不要求相同构造签名或相同常驻进程模型。Adapter 不自行扫描 PATH/安装目录、下载、安装或失败后改选程序；协议要求、原生参数映射、对所选目标的兼容校验及调用级 transport 释放继续归 Adapter。CLI 可以在自己的装配层提供发现便利，不将策略放回 Adapter 或 Kernel。

现有 metadata 用于执行描述与 probe 状态，不承载执行依赖和 owner。宿主可传入已解析启动描述、具体 client、factory 或 Provider 专用访问接口；可委托传输层创建和清理本轮独占进程，但引用不赋予共享 Engine 的关闭权。Windows shim/Node、探针与恢复也须使用宿主绑定的目标，逐轮 PATH/cwd 不得重新选择 Provider。协议配置环境变量及本轮工具环境继续遵守原合同。

2026-11-10 用户进一步明确 OpenCode 升级不应要求 octo-runtime 跟随修改版本准入：不设置最低版本、主版本名单或未知版本拒绝，调用前不执行版本探针。probe 中版本仅为可选展示信息；不能将版本命令非零退出或超时推导为已选 executable 不可用。OpenCode 按宿主绑定直接进入 JSON/ACP 协议，实际启动、协议和清理失败仍按本次结果报告。此原则不承诺任意上游协议变更自动兼容，也不添加旧版本适配层。

内置命令工厂要求显式绝对 command，可传 commandArgsPrefix 与基础 env；删除默认实例和裸命令兼容入口。CLI 使用宿主解析 helper，最终执行不再解析安装。源码审计、metadata 复用与实施验收见 [Issue 346 方案](../tasks/346-host-execution/design.md)。保留主线 #345 的 Codex 单实例与共享生命周期。

### KernelClient 与 AgentExecutor 的选型合同

接入场景分为 CLI 执行服务 + 独立 App，以及应用内纯原生嵌入。前者由 octo-runtime CLI 拥有 Kernel/内置 Harness，App 仅依赖 octo-runtime-client，经 RPC 调用，不加载 Adapter。后者统一从源码 workspace 依赖 Kernel/Core、公共辅助包与所选 Adapter，按需 import 或动态 import，初始化前完成注册；仅用 Codex 不引入 OpenClaw，反之亦然。private 源码包不单独 npm 发布；删除完整包的 /adapters/codex、/adapters/dsh 聚合入口，不以 CLI 全量依赖作为原生 SDK 接入方式。现有 CLI 仍加载 manifest 的全部装配项，Codex 进程在首次调用时启动，不能把进程惰性启动说成首次请求才加载模块。具体场景、依赖和所有权见 [SDK 入门](../../docs/zh-CN/getting-started/sdk.md)。

默认推荐 KernelClient，已有服务调用方仅安装 octo-runtime-client。直接 Core 是显式高级选择，宿主承担生命周期。完整 Runtime 与 client 同版本、自包含双包发行。npm 版本按用户确定的 1.1.11 → 1.1.12 递增；IPC v2、执行信封及 SDK 接口版本不要求 npm 升至 2.x。源码保留 0.0.0，由发行 tag 注入版本；不为旧接口增加兼容层。

## 独立渠道边界

Gateway 是独立 Git 仓库和 npm package：https://github.com/Mininglamp-OSS/octo-channel-gateway。`ChannelRegistry.register(endpoint, definition)` 只依赖公开 client。业务定义、函数、配置格式、会话存储、授权、重试和投递归 Gateway/应用。Runtime 不要求通用业务 JSON/schema，不提供渠道注册 RPC，也不发现、装配或管理渠道。Gateway CLI 自己提供 doctor/install/uninstall/start/stop/logs 等原有能力，不安装或启动共享 Runtime。

## 清理与恢复

消费者拥有自己的 client。关闭先停接纳，共享期限内取消并消费所属执行及业务尾流，最后关闭连接；不得停止共享 Kernel 或兄弟注册。取消 ACK 不等于终态，终态不等于投递成功。恢复只查询/续读原执行，不重放。清理不完整必须明确报告。

## 配置来源归宿主，SDK 消费配置值

执行边界采用 inputs 与 agentEnv 分离；业务 extra.* 仅可作为应用自己的格式，Runtime 不定义或渲染。当前 SDK/IPC v2 为用户授权的破坏性变更，保留执行信封结构。

### AgentEnv 直接由 Adapter 消费

AgentEnv 仅含 schema/items。Core 只读取 Adapter 路由，为本次调用复制快照并保序透传；配置语义校验、默认值和 Provider 原生映射归 Adapter，不生成中间配置对象。adapter-sdk 提供通用 item 读取和组合帮助函数、共性配置 helper；内置 Adapter 暴露独立副本 defaultAgentEnv 供宿主选用，执行时不向原信封追加默认条目。Core 保留执行、取消、watchdog 和清理生命周期；Adapter 解释预算后通过本地上下文配置 watchdog。

只有模型、思考强度等各 Harness 共用概念才定义公共 bean。私有 item 的命名、字段、类型、默认值及校验完全属于调用方与对应 Adapter，不进入公共 schema、catalog、生成类型或通用 SDK 专属配置模型。adapter.xxx 不是公共命名空间规范，不注册、不建立公共私有字段目录。新增专属参数无须公共登记或协议版本变更；由包内 README 维护权威合同，例如 [OpenClaw](../../packages/octo-runtime-adapter-openclaw/README.zh.md)。可信连接认证经本地 Adapter 上下文传递，不写回调用方 AgentEnv。

### agentEnv 不定义会话身份

agentEnv 是每次执行的显式配置，冻结仅保证本次调用不被后续修改影响，不要求同一会话各轮配置相同。Runtime 不对完整 agentEnv 建立跨轮相等性约束，不自动计算绑定签名，也不因配置变化自动递增 providerEpoch 或使旧表单失效。

异步问题的两条路径必须分开：活动时按原 RunRef/interactionId 回答，不用新配置重定向原执行；确认正常完成后，新 Run 的 agentEnv 由 Gateway/宿主显式选择并授权。AsyncQuestionReply 是宿主选择使用的便利控制者，continuation 回调承担这项决定；它不证明回调读取的全局“当前配置”适合原题。宿主不能确定目标或授权时必须拒绝续跑。

sessionId/sessionGeneration、providerSession.sessionId 和可选 providerEpoch 用于身份/代次核对，不证明执行配置相等。providerEpoch 表达宿主认定的 Provider 绑定替换，不是任意配置修改计数。省略时 SDK 无法识别相同 ID 背后的绑定替换；宿主必须通过自身控制者生命周期或显式代次隔离旧表单，不能把旧 providerSession 投向另一个 Adapter、账号或不共享该会话身份的服务端。调整配置不豁免权限校验、Provider 配置支持和真实恢复结果。完整条件见[异步问题协议](protocol-design.md#异步续跑配置与身份边界)。

## 凭据值严禁进入代码仓库

真实凭据由宿主从仓库外注入，不写日志、命令参数或提交。Harness 认证及模型目录由 Provider/宿主管理；测试占位值在运行期生成。

## CLI 面向普通用户的产品默认值

Runtime CLI 只管理 executor-kernel，运维命令直接使用顶层 start/run/logs 等；不保留 executor-kernel 子命令或兼容别名。start 未安装时自动安装并等待就绪；install 默认自启；stop/uninstall 保留配置与数据。帮助和版本查询不加载 Provider。不得改写或删除旧 Home 来迁移渠道。

## 本地信任边界：同一操作系统账号内互信

本地客户端以 OS 账号为信任边界；本地存在和执行不以云端登录、登记或 IM 建联为前提。状态和缓冲必须有界，业务历史不进入 Core。

## 实现语言与原生依赖边界

公共执行层采用 TypeScript/Node.js，不引入 Go/native 辅助实现或随包二进制。Provider CLI 与业务工具由宿主选择和管理。

## GitHub CI 范围约束

专项手动验证，不扩大 CI。记录实际平台和外部服务验收边界，不以规划 95 分代替实施验收。

## 强制定位：执行基础设施不得代替产品决策

行为模式、模型、思考强度、新建/续接/重置会话和界面选项由产品显式决定。Runtime 公共层只做协议校验和完整传递，Adapter 直接读取配置并映射 Provider。省略可选值不授权框架补历史、继承产品状态或重设模式；defaults/mandatory 及权限合同继续有效。降级、重试和其他自动动作必须有已确认合同，不从网络错误或未知状态推导兜底授权。

## 模型目录归 Provider 与宿主：以 Issue 193 为例

同一 Provider 可以连接不同代理和账号，Adapter 类型、安装版本或官方静态表不能代表实际后端目录。adapter.list 描述实际装配及探测状态，不是模型目录服务。宿主选择目录来源、刷新、展示和缺失处理；Runtime 不为模型选择器新增目录 RPC、扫描认证、创建探测会话或推断权限。显式模型继续按原合同传递，必要的原生广告目录校验仍由对应 Adapter 执行，不建立通用白名单。

## Provider harness 认证归宿主与 harness

HostApp 选择安装与认证方案。Runtime 不隐式登录、刷新业务凭据或改变 Provider 私有认证文件。业务配置源可为文件、数据库或服务，SDK 只消费已经准备好的值；更换存储来源不应改变执行合同。框架自己拥有的 IPC、身份、租约和状态仍须按既有安全合同保护。

## 按责任归属修复问题

最先违反协议或产品输入合同的模块负责修复；下游不猜测正文、不改写意图来掩盖错误。Provider 差异终止在 Adapter，业务错误留在发起方，Core/Kernel 不根据渠道或 Adapter 名称增加业务分支。SDK 是主要接入方式；Electron/Tauri 等宿主直接使用 SDK，不通过 CLI 输出解析接入。

## 人格与 SOUL 的注入归业务方

应用在调用前把人格、SOUL、启动提示词、业务材料和当前文字/图片编译为普通 inputs.parts，并决定顺序及新建、续接和重建时的携带策略。Runtime 不提供 system/developer/受信指令角色，也不按会话状态补提示词、标签或分隔符；主输入和显式 fallback 输入各自完整，冻结重试不重复前置。agentEnv 继续承载 MCP、环境变量及执行配置，不因提示词迁移进入正文。Issue 334 删除旧 octo.control/instructions 和 controlInstructions，旧项/字段即使为空也拒绝；独立 Gateway 须在自己的业务配置和编译边界另行迁移。

## 资源地址 Context 与按需取材

发起方可以提交资源地址、来源和获取指引，由 Agent 在正常工具循环内按需读取。Host、Core 和 Adapter 不自动预取、摘要、补齐或持久化业务历史。workdir 是工作位置而非操作系统隔离边界；附件交付与工具动作属于业务消费者。

## 应用工作目录归调用方

Issue 335 的执行边界为调用方已成功准备的绝对目录 → Adapter 校验 → Provider 执行。CLI 与 SDK 均须显式传入 workspace.path，不默认取 cwd、Home 或旧会话，不分配随机目录、不在缺失或恢复时重建。workspace payload 仅含 path，删除 fixed/random/none mode、workspace_mode、prepareRunContext 和 WorkspaceAssignments，不保留兼容转换。已有用户目录不删除。

路径在 Provider 操作前检查；缺失、非法、不存在、非目录及不可访问分别返回 WORKDIR_REQUIRED/INVALID/NOT_FOUND/NOT_DIRECTORY/UNAVAILABLE，公开分类沿用 OH-ADP-3004。续接和 fresh recovery 仍使用本次调用路径，消失就失败；校验不承诺消除文件系统竞态。声明 metadata.workspace:false 的 Adapter 可以没有本地覆盖，OpenClaw 的原生工作区归 Provider，不制造或 stat 远端路径。Runtime Home、日志、IPC 及 Provider 自有状态与应用目录分别管理，运维目录的既有创建与清理不因本次删除而扩大。

## 业务动作归 Agent tool call，Context 约束行为

octo-cli 是业务团队的 API 工具，与 Runtime CLI 不同。是否预置、版本、路径、凭据和授权归 HostApp；Runtime 不为业务动作隐式安装工具。业务动作由 Agent 显式调用，Context 不授予额外权限。Runtime 不维护业务 Agent 定义、设备共享、云端登记、会话数据库或可靠业务 outbox。

## 保持的执行约束

原生 Kernel 和 Core 共享宿主故障域，RPC 不提供执行 worker 隔离。Core iterator 提前关闭请求取消；Kernel 观察 iterator/连接关闭只结束观察。Windows taskkill 依赖可识别的进程树，leader 先退、宿主被杀或事件循环阻塞时不能承诺后代清空；cleanup.complete 只能代表实际确认范围。不得把强退当作执行或投递成功。

业务调用方负责 endpoint 寻址、设备选择、授权候选与故障转移，再使用 octo-runtime-client 向已选定的 Runtime invoke。Runtime 是执行边界，不登记 octo.runtime/selection、已解析候选或寻址 schema，也不补齐或合并路由策略；不得从 AgentEnv 恢复设备调度责任。
