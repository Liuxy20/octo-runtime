---
type: Design
title: Issue 339：模块、对象与生命周期所有权方案
description: 细化宿主、Kernel、Core、Adapter、常驻服务及 Home 的职责，定义获取、释放、恢复与关闭的边界。
tags: [architecture, lifecycle, ownership, adapter, envs, mcp]
---

# 状态与术语

本文件记录 #339 设计与实施合同。初始基线为 157fabb7，实施期间同步到 main d5aeae70，保留 #337 的调用方提示词/工作目录合同。当前对外说明见[中文架构](../../../docs/zh-CN/concepts/architecture.md)和[英文架构](../../../docs/en/concepts/architecture.md)，实际证据见[验证](validation.md)。

- Engine：实际执行 Provider 协议的实例，例如常驻 codex app-server；不是 Adapter，也不是 agentEnv。
- owner：有权创建、恢复和最终关闭特定资源的主体；持有引用不等于 owner。
- Codex Engine provider：宿主注入给 Codex Adapter 的访问依赖，为一次调用获取隔离的 channel/lease；这是 Codex 专用方案用语，不是所有 Engine 必须实现的公共接口，不代表已有 npm 版本已发布。
- lease：只授权本次调用使用和释放所分配资源，不默认授权关闭共享连接或 Engine。
- Home owner：决定目录位置、访问权限和持久数据生命周期的宿主；可以与 Engine owner 不同。

## 实施前调用与资源关系

调用链是 KernelClient → Runtime IPC → Kernel → Core → Adapter → Codex stdio JSON-RPC。SDK 直接 Core 是低层选择，不替代正常 Kernel 接入。

实施前 Core.register 创建 AdapterExecutionScope，Codex scope 同时保存 services 和调用状态；Core shutdown 因关闭 scope 而停止恢复及回收进程。本次将 services 与监督权提取到宿主创建的 managed owner，scope 仅保留本地调用与 lease。CodexTurnChannel 不再是 Adapter 的具体类型依赖，由结构化 CodexChannel 合同替代；下表描述实施后的边界。

## 模块与对象所有权

实现补充：Kernel 接收宿主的 serviceProcesses 安全只读快照，以及显式 finalizeHostResources(deadline) 收尾回调。后者在 Core/Run 排空后、持久所有权证据释放前运行；CLI 在回调内关闭自己持有的 assembly，失败则保留 cleanupFailed/端点租约。Kernel 不认识具体 Engine、manifest 或构造参数。借用业务共享 Engine 的 Kernel 不注册其 owner disposer。doctor 以真实 owner_pid 将默认 app-server 展示为 CLI Host/Kernel 的子资源，不以 Adapter 为 PID 树节点。

| 模块或宿主 | 持有或消费的对象 | 创建及最终生命周期责任 | 借用边界 |
| --- | --- | --- | --- |
| Electron / 应用宿主 | KernelService、业务具体 client 及其他自定义依赖、Engine owner、按需使用的 Home 配置 | 应用创建并协调自己拥有的对象；共享 Engine 由其既有 owner 最终关闭 | 不通过 CLI 启动 SDK；不关闭其他应用的资源 |
| Runtime CLI | 默认托管 Engine owner、Adapter、KernelService、日志和信号 handler | run 所在服务进程创建并收尾；Playboard 持有临时装配；start 客户端只管理原生服务动作 | 默认配置不向普通用户暴露新所有权必填项 |
| cross-service | ServiceSpec、平台 backend、管理命令进程 | CLI/安装器显式调用；OS 管理器运行 Kernel 宿主进程 | 不把 installed/running 当 Provider ready，不接管 Engine 协议 |
| host-sdk | Home/identity/endpoint 辅助值与诊断 | 调用者决定配置及持久数据保留；辅助函数不成为资源 owner | 不做通用 Engine supervisor，不按环境偷偷选择 CODEX_HOME |
| executor-kernel | AgentExecutor、RPC server/socket、Run 窗口、内部 client、日志及资源记录 | KernelService 创建并有界关闭自己创建的资源；宿主关闭 KernelService | 不根据 Adapter 类型创建或销毁业务 Engine；socket 断开只结束观察 |
| executor-core | Adapter 注册、每注册 scope、调用控制器、迭代器、交互路由 | Core 管理接纳与自己调用的取消/清理，关闭自身 scope | scope 不能通过借用依赖取得底层 Engine 的销毁权 |
| adapter-sdk | Adapter 合同、scope/cleanup 类型、队列/进程/日志辅助对象 | 具体调用者拥有自己构造的对象；辅助库不持有全局 Engine | scope API 必须描述本地资源与借用 release，不混为全局 process close |
| Codex Adapter | 注入的 Engine provider 引用、本轮 channel lease、协议状态与交互映射 | Adapter scope 持有本地调用状态；每轮 finally 释放该 lease | 不持有 Engine supervisor 的销毁权限；不自行选 Home 或恢复共享 Engine |
| 可复用 Codex 托管模块 | 配置服务池、owned 子进程、stdio reader/writer、pending RPC、恢复 timer、incarnation | 实际宿主构造 owner 并最终关闭；模块按 owner 的明确合同惰性启动/恢复 | 与协议适配分模块；不要求独立 npm 包，也不由 Core 注册隐式创建 |
| Codex 业务访问依赖 | 业务连接及请求关联器、本调用 lease | 业务 owner 决定连接创建/复用/恢复；Codex provider 按合同分配、释放租约 | 不把共享 stdio 交给两个无协调的读取者；共享连接的全局关闭只归 owner |
| 自定义黑盒 Engine Adapter | 宿主传入的任意构造依赖、本调用状态及订阅 | 具体依赖的生命周期按宿主与 Adapter 的明确约定维护；Adapter 维护自己的调用状态 | 不要求依赖实现 Codex provider/channel、提供 PID/Home 或使用 stdio；参数传入不隐含管理权转移 |
| acp-client / 其他 Provider Adapter | 当前逐轮子进程、ACP client、原生会话队列或远端连接 | 继续使用其现有执行资源所有权；明确调用者负责 close | 不因 #339 强制改造全部 Provider；发现常驻依赖时按同一原则单独核实 |
| protocol | 类型、Schema、身份与执行信封 | 无 Engine 资源生命周期；协议资产维护者维护定义 | 不序列化存活对象、关闭函数或进程控制权 |
| runtime-client | 自己的连接、调用登记、观察及控制句柄 | 消费者先停止接纳并排空自己调用，再关闭 client | close 不停止共享 Kernel 或 Engine；控制 ACK 不证明执行终止 |
| 独立 Gateway / 业务系统 | inputs、agentEnv、业务会话绑定、投递与存储 | 各消费者维护自己的业务对象及 client | 不借 Runtime 注册获得 Engine 或 Home 管理权限 |

## 两种装配路径

默认托管：CLI 服务宿主 → 构造托管 owner/provider → 构造 Codex Adapter → 注入 Kernel。托管 owner 保留现有惰性启动、健康复用、配置分池和有界恢复；创建 owner 不表示立刻启动所有配置的 app-server。

业务自管 Codex：Electron 业务 owner → 提供 Codex 访问依赖 → 构造相同 Codex Adapter → 注入 Kernel。协议转换仍由默认 Codex Adapter 完成。

## 扩展合同：Adapter 构造方式不受 Runtime 限制

Runtime 不限制 Adapter 的构造方法、参数数量、参数类型、参数顺序或依赖注入形式。业务可以使用类构造函数、任意签名的工厂、闭包或直接构造对象；可以传具体 XxxClient，也可以传配置、连接池、SDK 实例、函数及其他任意依赖。是否传 client、是否采用统一 options 对象均由该 Adapter 的实现者决定，不是注册前提。

例如 Electron 可自己维护一个黑盒 AgentEngine 及其具体 client，再传给专用 Adapter；也可传多个对象或业务回调。宿主在进程内完成构造后，将满足 HostedAdapter 合同的结果传给 Core/Kernel。Runtime 不检查构造参数、不认识业务依赖类型、不按 Engine 名称增加分支，也不要求业务先实现通用 Engine/client/provider 基类。

Core/Kernel 只约束构造结果的执行合同，包括协议声明、invoke 事件、所支持的交互和取消/清理行为。对参数“不限制”不表示可以伪造执行终态或忽略取消结果。依赖的所有权、恢复权和关闭权由宿主与 Adapter 明确约定；仅传入对象或对象存在 close 方法，都不代表管理权转移。共享依赖仍由其 owner 维护，Adapter 释放自身调用状态和订阅。

CLI 的 manifest 工厂入口有其自身序列化配置及调用约定，只是 CLI 宿主的一种装配机制，不是 SDK Adapter 构造规范。SDK 不需要把存活对象放进 manifest、agentEnv 或 RPC，也不需要为满足 CLI 工厂签名修改业务构造函数。

下面的 provider/channel/lease、stdio、incarnation、兼容配置池和 CODEX_HOME 设计只适用于 Codex；其他 Adapter 自行选择适合的构造依赖和协议实现，不要求实现这套 Codex 专用接口。

## Codex 专用访问依赖

对于 Codex，目标选择注入 provider 而不是固定裸连接。provider 必须能根据本轮已解析配置决定是否可服务，并获取单调用 lease。实际接口为 createCodexAdapter({engine: CodexEngineProvider})；provider.acquire 返回 {channel, configuration}，configuration 仅含 MCP 视图；createManagedCodexEngine({codexHome, command?, appServerArgs?, env?, spawnFn?}) 返回宿主持有的 owner。以下语义不可省略：

1. 获取输入包含执行所需的兼容配置及本次等待取消信号。Codex 专用配置解析留在 Codex 模块，不要求 Core/Kernel 识别 Provider 私有参数。
2. 获取输出提供协议 channel、可验证的代次/关联信息、本轮所需的有效配置视图和幂等 release。不能要求业务创建 CodexService、ChildProcess 或内部 writer 类。
3. channel 隔离 thread/turn、RPC ID 和通知路由；连接总关联器归连接 owner。两个 Runtime 共用 Engine 时必须共享受控关联器，不能各自从 1 分配 RPC ID 或直接覆盖 onMessage。
4. Adapter 正常结束、取消或 scope 关闭，只取消自身请求并 release 自身 lease。release 不等于全局连接 close；独占连接是否随 release 关闭必须由 provider 合同明确。
5. acquire 等待取消不得中断兄弟调用的共享启动。scope 关闭后迟到 acquire 必须 release，不能发布新活动调用；不能通过 finally 失败伪造完整清理。
6. 不把 engine.close/restart 暴露到 Adapter 所需最小依赖。宿主持有单独的 owner handle；诊断使用只读快照，不把借用 PID 宣称为本 Runtime 的受管进程。

托管 owner/provider 首先可作为 Codex 包内独立模块，经现有 public/codex.ts 子路径导出。分离的是职责和所有权，不以增加 package 数量作为验收。默认 CLI 装配增加自己的资源清单/cleanup handle，不能只把 loader 返回的数组藏进新 supervisor。现有 manifest 的默认 Codex 对象入口及自定义工厂需要显式迁移；不保留零参数工厂暗中创建 owner 的兜底。普通 CLI 使用方式和默认配置含义保留，旧 SDK 创建方式在迁移指南解释。

## CODEX_HOME：配置、进程和数据分别管理

宿主在构造 Engine provider 或托管 owner 时显式传入 CODEX_HOME。CLI 作为默认宿主可以读取自身受信环境、采用原有 ~/.codex 默认值，并按宿主策略准备目录；SDK、Adapter 和托管库不得自行回退到进程用户目录。缺失输入在分配 Engine/发起 turn 前明确拒绝，不增加每次调用都必须重复传目录的要求。

| 对象 | 责任主体 | 允许行为与生命周期结束 |
| --- | --- | --- |
| CODEX_HOME 位置及目录准备 | Home owner | 选择绝对位置或由宿主完成规范化；决定是否创建，准备后注入 |
| 目录访问权限及共享策略 | Home owner / 操作系统 | 宿主确认运行账号及访问方式；不得因接入而 chmod、重置其他 owner 的共享目录 |
| 认证、配置、skills 和原生会话数据 | Home owner 与 Codex 原生工具 | 用户/宿主决定保留、更新及删除；Runtime 不自动登录、迁移或清空 |
| Engine 进程 | Engine owner | 启动、恢复、退出；退出不结束 Home 的数据生命周期 |
| 本调用的 channel / lease | Adapter 调用 | finally 释放；不改目录权限、不删除磁盘数据 |

Runtime Home 与 CODEX_HOME 不同；前者保存 Kernel 自身状态，后者是 Provider 数据。关闭 Kernel、取消一轮、切换配置、恢复 app-server 和卸载服务都不授权删除 CODEX_HOME。SDK 调用方通过 agentEnv/env 提供与宿主已选 Home 冲突的值时必须拒绝，不允许借此重定向业务已有 Engine；托管 provider 只有在宿主明确配置多 Home 路由时才分配另一池。实现时明确 Windows 环境变量大小写及入口优先级，不能保留两个互相矛盾的 CODEX_HOME 值。

env/cwd/MCP/executable/revision/流限额等仍参与实际兼容选择。提供相同 Home 不证明相同凭据或会话可恢复；provider 必须拒绝自己不能应用的配置，不静默丢弃。原生程序按已授权配置写自己的 Home 属于 Provider 正常行为，不等于 Adapter 获得目录管理权。

## 关闭、失败和恢复

宿主发起整体关闭时：停止本装配的新调用和新资源获取；在同一绝对 deadline 内取消并排空所属调用；关闭 Kernel/Core 的本地资源和全部租约；最后由 owner 关闭其 owned Engine。为避免空闲故障在排空期间触发恢复，托管 owner 可以先禁止新的自动恢复，但必须允许既有 lease 完成定向控制及清理。借用共享 owner 的单个 Runtime 关闭不得关闭 provider 的全局准入。

若调用清理超时，宿主仍可在其所有权内终止 owned Engine，但必须保留调用和进程清理的分别结果。独立资源即使前项失败也必须尝试回收；借用 Engine 不被强制终止。现有 Date.now() 与 performance.now() deadline 使用不同时间原点，跨层传递时必须显式转换，不能直接比较。

部分装配失败按本装配资源清单反向释放；只关闭本次创建的 owner，不关闭注入的共享 owner。Kernel 初始化失败但 Engine 已创建时，CLI/SDK 示例必须保留原失败和 cleanup incomplete，不能让 throw 跳过后续 disposer。

owned Engine 故障由托管 owner 保持现有单飞恢复、incarnation 和有界预算；业务自管 Engine 由业务 owner 恢复，Adapter 报告本次真实失败/未知，不自行 spawn。恢复不能重放已接纳 turn、工具动作或控制决定。旧 lease、RPC requestId 和交互不得落到新 incarnation；配置变化不替代宿主的 providerSession/epoch 授权。
