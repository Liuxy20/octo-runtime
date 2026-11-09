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

### KernelClient 与 AgentExecutor 的选型合同

默认推荐 KernelClient，已有服务调用方仅安装 octo-runtime-client。直接 Core 是显式高级选择，宿主承担生命周期。完整 Runtime 与 client 同版本、自包含双包发行。npm 版本按用户确定的 1.1.11 → 1.1.12 递增；IPC v2、执行信封及 SDK 接口版本不要求 npm 升至 2.x。源码保留 0.0.0，由发行 tag 注入版本；不为旧接口增加兼容层。

## 独立渠道边界

Gateway 是独立 Git 仓库和 npm package：https://github.com/Mininglamp-OSS/octo-channel-gateway。`ChannelRegistry.register(endpoint, definition)` 只依赖公开 client。业务定义、函数、配置格式、会话存储、授权、重试和投递归 Gateway/应用。Runtime 不要求通用业务 JSON/schema，不提供渠道注册 RPC，也不发现、装配或管理渠道。Gateway CLI 自己提供 doctor/install/uninstall/start/stop/logs 等原有能力，不安装或启动共享 Runtime。

## 清理与恢复

消费者拥有自己的 client。关闭先停接纳，共享期限内取消并消费所属执行及业务尾流，最后关闭连接；不得停止共享 Kernel 或兄弟注册。取消 ACK 不等于终态，终态不等于投递成功。恢复只查询/续读原执行，不重放。清理不完整必须明确报告。

## 配置来源归宿主，SDK 消费配置值

执行边界采用 inputs 与 agentEnv 分离；业务 extra.* 仅可作为应用自己的格式，Runtime 不定义或渲染。当前 SDK/IPC v2 为用户授权的破坏性变更，保留执行信封结构。

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

行为模式、模型、思考强度、新建/续接/重置会话和界面选项由产品显式决定。Runtime 只做合同内配置解析、协议校验、完整传递和 Provider 原生映射。省略可选值不授权框架补历史、继承产品状态或重设模式；defaults/mandatory 及权限合同继续有效。降级、重试和其他自动动作必须有已确认合同，不从网络错误或未知状态推导兜底授权。

## 模型目录归 Provider 与宿主：以 Issue 193 为例

同一 Provider 可以连接不同代理和账号，Adapter 类型、安装版本或官方静态表不能代表实际后端目录。adapter.list 描述实际装配及探测状态，不是模型目录服务。宿主选择目录来源、刷新、展示和缺失处理；Runtime 不为模型选择器新增目录 RPC、扫描认证、创建探测会话或推断权限。显式模型继续按原合同传递，必要的原生广告目录校验仍由对应 Adapter 执行，不建立通用白名单。

## Provider harness 认证归宿主与 harness

HostApp 选择安装与认证方案。Runtime 不隐式登录、刷新业务凭据或改变 Provider 私有认证文件。业务配置源可为文件、数据库或服务，SDK 只消费已经准备好的值；更换存储来源不应改变执行合同。框架自己拥有的 IPC、身份、租约和状态仍须按既有安全合同保护。

## 按责任归属修复问题

最先违反协议或产品输入合同的模块负责修复；下游不猜测正文、不改写意图来掩盖错误。Provider 差异终止在 Adapter，业务错误留在发起方，Core/Kernel 不根据渠道或 Adapter 名称增加业务分支。SDK 是主要接入方式；Electron/Tauri 等宿主直接使用 SDK，不通过 CLI 输出解析接入。

## 人格与 SOUL 的注入归业务方

执行边界采用 inputs 与 agentEnv 分离；业务 extra.* 仅可作为应用自己的格式，Runtime 不定义或渲染。当前 SDK/IPC v2 为用户授权的破坏性变更，保留执行信封结构。

## 资源地址 Context 与按需取材

发起方可以提交资源地址、来源和获取指引，由 Agent 在正常工具循环内按需读取。Host、Core 和 Adapter 不自动预取、摘要、补齐或持久化业务历史。workdir 是工作位置而非操作系统隔离边界；附件交付与工具动作属于业务消费者。

## 业务动作归 Agent tool call，Context 约束行为

octo-cli 是业务团队的 API 工具，与 Runtime CLI 不同。是否预置、版本、路径、凭据和授权归 HostApp；Runtime 不为业务动作隐式安装工具。业务动作由 Agent 显式调用，Context 不授予额外权限。Runtime 不维护业务 Agent 定义、设备共享、云端登记、会话数据库或可靠业务 outbox。

## 保持的执行约束

原生 Kernel 和 Core 共享宿主故障域，RPC 不提供执行 worker 隔离。Core iterator 提前关闭请求取消；Kernel 观察 iterator/连接关闭只结束观察。Windows taskkill 依赖可识别的进程树，leader 先退、宿主被杀或事件循环阻塞时不能承诺后代清空；cleanup.complete 只能代表实际确认范围。不得把强退当作执行或投递成功。
