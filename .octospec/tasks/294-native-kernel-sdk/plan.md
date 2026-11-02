---
type: Plan
title: Issue 294：宿主流程、实施阶段与稳定性验收
description: 明确 Electron 与 CLI 的装配、RPC 和清理流程，列出实现前必须核对的稳定性边界。
tags: [architecture, adapter, ipc, lifecycle, testing]
status: implemented-locally
---

# 实施依据

以[简报](brief.md)和[架构规则](../../rules/architecture.md#sdk-原生装配与统一-rpc)为准。计划已进入实施；源码、测试和文档变更以当前工作树为准，执行记录见[验证记录](validation.md)。此文件不复制函数签名或建立签名迁移表。

## Electron 宿主流程

1. **选择与准备。** 主进程通过公开入口 import 所选 Adapter 与 Extra。宿主取得配置值，调用必要工厂并准备宿主依赖；不读取 CLI 默认清单、不要求外部 Node 或执行 worker 文件。
2. **确定地址。** 宿主选择数据目录、状态位置和本地 RPC endpoint。可以用 `componentEndpoint(home)` 派生地址；Home 目录本身不是 socket/pipe。不得因为调用方同进程而省略 RPC。
3. **构造服务。** 主进程将实际 Adapter 对象交给 `createKernelService`，Kernel 在该进程创建执行器并持有服务资源。对象的原型方法、`this`、闭包和依赖引用留在当前进程，不传入 JSON，也不在另一进程重新 import。
4. **初始化。** 等待 `initialize()` 成功，才向业务提供 `kernel.client`。失败核对原始 cause 和清理结果；监听成功、执行可接纳、Provider 可用是不同事实。
5. **执行。** 主进程业务和 renderer 经宿主桥接提出的执行请求最终使用 KernelClient，沿真实 socket/pipe RPC 进入同一个 Kernel 的接纳与执行链。宿主桥接不新增 Kernel 执行旁路。
6. **加载 Extra。** 宿主通过原生 Extra 服务注入其模块和业务函数，为其选择同一 Kernel endpoint。Extra 用独立 `ctx.kernel` RPC client 发起和控制自己的调用；业务依赖查询按 Extra 合同在本进程执行，与 Agent 执行 RPC 分开。
7. **消费与控制。** 消费源事件直至真实终态，按原身份处理交互和取消。关闭观察不取消执行；取消 ACK 不等于执行结束；执行结束不等于投递或存储已完成。
8. **关闭。** 停止新业务，关闭 owned Extras 并等待所属调用、消费者和业务收尾，再关闭 owned Kernel并检查 `complete`。宿主随后关闭自己的数据库等资源；incomplete 保留事实，不以进程退出伪装成功。

## CLI 宿主流程

1. **读取宿主来源。** CLI 解析 Home/profile 和显式 `--manifest`，沿现有优先级选取内置/Home 模块清单及允许的 Extra 来源。完整替换、同名去重、未选模块不加载等规则保持。
2. **装配对象。** CLI 自己保留来源锚点、解析模块、动态 import 并调用选中工厂。模块路径、导出名和工厂选项都停在宿主装配层，Kernel 不接触它们。只实例化一次，不用模块名称猜测实际 Adapter type。
3. **宿主准备。** CLI 按已选实例真实 metadata 完成已有的 OpenClaw 准备、DSH 安装选择等产品装配，准备配置值与日志位置。该流程不进入 Kernel，不因拓扑改变新增 Provider 探测或安装策略。
4. **托管 Kernel。** 组件 run 入口将对象和 endpoint 交给相同 `createKernelService`，等待 `initialize()`，原生服务管理器管理该宿主进程。Kernel 工厂不再 spawn 执行 worker；不能以临时 JS/manifest 维持旧路径。
5. **普通命令。** 执行/查询/控制命令通过 `attachKernel({ endpoint })` 访问已存在服务。client.close 只关闭自身连接；消费命令不创建或关闭 shared Kernel。
6. **独立 Extra。** Extra 的组件 run 入口原生加载对应模块，连接指定 Kernel；它可以与 Kernel 分别部署，不启动或关闭 Kernel。CLI 读取统一目录不意味着 Kernel 持有 Extra。
7. **Playboard。** CLI 使用同一对象装配流程，但沿既有约定创建本次临时端点、跳过 Extra 和相应渠道准备。执行仍走 `kernel.client` RPC；只在确认清理后删除本次资源。
8. **停止服务。** CLI 宿主处理信号、调用 close、等待尾流与清理并报告实际结果；有界最终退出只属于可执行宿主，不进入 SDK。Home、身份、配置和其他服务资源保持原有所有权。

## 责任检查案例

规范中的[六类案例](../../rules/architecture.md#装配职责与典型案例)是评审依据。以下三个容易误判的组合必须单独核对：

- **原生注入对象 + RPC 调用可以同时成立。** RPC 传请求、事件与控制，不传 Adapter 函数。RPC 到达 Kernel 后，由其 Core 使用已经在本进程注册的对象；宿主不因持有 Adapter 引用就直接执行它。
- **CLI 使用 manifest 不意味着 Kernel 支持 manifest。** “CLI 先解析路径，再让 Kernel import”仍然越界；只有宿主已经构造好的 Adapter 才是工厂装配输入。公共工具是否复用不改变执行责任，Kernel 包不保留模块目录 loader/导出。
- **Adapter 内部 spawn 与 Kernel worker 是不同用途。** Adapter 可以启动其 Provider 的原生服务或 CLI；不能将一份执行 AgentExecutor 的 runner 包装成 Provider 子进程来绕过本次约束。

## 稳定性迁移矩阵

| 既有能力 | 目标处理 | 所需验证证据 |
| --- | --- | --- |
| RPC 接纳、输入校验和 Run 身份 | 保留共同入口与关联；同进程业务也通过 wire | Electron 风格宿主和 CLI client 的请求进入同一 RPC handler；非法请求在执行前拒绝 |
| 请求观察与执行所有权 | Kernel 继续消费已接纳的执行源 | client/订阅断开后原 Run 继续，重连只读取原执行，不重复调用 Adapter |
| ACK 丢失、原身份查回、原游标续流 | 保留既有预算与明确失败 | ACK 丢失不重投 invoke；身份变化、游标缺口与过期如实失败 |
| 取消、交互与真实终态 | 沿同一 RPC/Core/Adapter 路由 | 取消受理和终态分开；回答不误投其他 Run；同步/异步交互按已有合同处理 |
| 容量、背压、截止与异常归属 | 保留服务与 Core 的有界管理 | 慢消费者、多调用与单 Adapter 失败不被转为全局成功/静默丢弃；不新建无界队列 |
| 初始化取消、bind 竞态与 close | 保留共享截止、回滚、迟到回收和 incomplete | 取消发生在绑定或初始化期间；重复 close 一致；未释放资源阻止冲突替换 |
| Extra 隔离与业务收尾 | 每个 Extra 的 client 只管理自身调用 | 关闭 Extra A 不关闭 Kernel/Extra B；终态、投递与数据库关闭顺序各有依据 |
| 原 worker 心跳、替换和故障隔离 | 不恢复执行 worker；明确共享宿主故障域 | 不伪造 worker PID/ready/recovery；同步阻塞、OOM、进程退出不被描述为可由同进程 RPC 隔离 |
| Kernel 状态/日志与旧资源记录 | 按真实资源更新状态；旧清理事实必须可解释 | 旧身份、锁和未确认回收记录不被删除/忽略；状态 schema、客户端与 CLI 展示一致 |
| Adapter 所属 Provider 进程 | 保留原生交互与回收合同 | Provider 启动失败、取消、清理不完整逐调用报告；Kernel 无执行 worker 不等于系统无任何子进程 |

此矩阵定义实施验收，不宣称当前代码已满足。宿主进程故障后的重启由宿主负责；不增加自动重跑旧 Run、持久执行恢复或对同步阻塞的强停承诺。

## 实施阶段

1. **核对源码与剩余设计。** 从 `service.ts`、`server.ts`、`supervisor.ts`、`host-run-service.ts`、`rpc.ts` 和 Core 注册入口梳理生命周期。确定 `KernelStatus.worker` 等状态、旧清理记录、环境和日志上下文的处理方式；其他既有服务选项本轮不宣布增删。
2. **共享服务装配。** 接入实际 Adapter 对象，使用唯一 Core 实现，并保留 HostRunService 的源管理及公共 RPC。Kernel 模块清单读取、解析/import 与执行 worker 链路退出标准服务；不能改成换名 launcher。
3. **宿主接线。** CLI 常驻服务与 Playboard 在宿主侧完成装配及既有产品准备；Electron 示例使用公开 SDK 原生 import。Extra 保持自己的 RPC client 与资源所有权。
4. **本地验证。** 按下列验收项执行针对性检查，记录源码版本、平台、命令与实际结果。专项显式手动运行；不得改 workflow/job/矩阵/触发器/必需检查或默认测试开关扩大 CI。
5. **公开文档对齐。** 实现可用后再更新双语 SDK/CLI、包 README 与可运行示例，协同 #293。规范先行不代表现有示例已迁移；不得只改示例类型或文案后宣告完成。

## 验收状态

- [x] 包外严格 TypeScript 消费者使用公开导出，注入实际 Adapter，无执行 worker 文件或模块 manifest。
- [x] Node 宿主经真实 RPC 保留原型、this、闭包和宿主依赖；Kernel 不 spawn 执行进程。
- [x] CLI 常驻服务和 Playboard 在宿主选取/import/构造模块；未选模块不加载，工厂不重复执行。
- [x] 本地覆盖接纳、观察恢复、取消、交互、ACK 未知、绑定竞态、关闭失败和遗留资源记录。
- [x] 文档签名和实现一致；SDK 接入页精简为 API 表与例子，未扩大 CI。
- [x] Node fixture、真实 Electron、Provider 和平台证据分别登记；未执行项不记为通过。
- [ ] 真实 Electron 打包运行、真实 Provider 联验及 Windows/Linux 原生平台验证：本轮未运行。

## 实施决策

KernelStatus 只保留协议版本、instance、宿主 pid 和 execution_ready；不提供 worker 恢复状态。资源记录仅接受原生 owner 格式并保留清理未确认事实；旧 worker 格式拒绝且不改写，不提供兼容或升级。旧 stdio WorkerRpc、心跳和 worker 恢复实现一并删除。逐调用环境继续通过 RPC 的 InvokeEnvironment 传递，Kernel 不修改 process.env。日志在 Core/Run 排空后关闭。具体测试与边界见[验证记录](validation.md)。
