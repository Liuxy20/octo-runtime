---
type: Plan
title: Issue 71 评审整改：有界收尾、公开模块与规则一致性
description: 基于 main 70f0247 实施三个评审问题的修复，记录关闭合同、公开模块和验收证据。
tags: [architecture, lifecycle, sdk, testing, extra]
status: locally-validated
---

# 目标与状态

本方案位于当前 worktree `octo-runtime-71-unified-sdk`，分支 `refactor/71-unified-sdk-services`。协议与行为基线为本次已拉取的 `origin/main@70f0247ac7dc00cc9729b366eba64ea8288b5b78`。旧分支只作参考，不覆盖 main #73 的共享 invoke 或 #72 的 Gateway 排空、终态和失败语义。

用户授权实施后，三个评审问题已在当前 worktree 修复。代码、公开导出、规则及实际 tgz 已验证；逐项证据见文末及[实施记录](implementation.md)。尚未提交、推送或创建 PR。

| 编号 | 问题 | 修复目标 |
| --- | --- | --- |
| R01 / P2 | 工程规则仍要求 owner 控制通道代理依赖 | 当前有效规则统一为同进程直接调用；可选状态 socket 不代理依赖或代启服务 |
| R02 / P1 | close 立即 abort owner，注入依赖随即拒绝，终态无法保存 | 停止新 invoke，允许已有任务有界收尾；清理结束或到期后拒绝后续依赖调用 |
| R03 / P2 | WebUI/WeCom 缺少公开模块出口 | 只安装主发行包即可公开导入、原生构造并关闭三个内置 Extra |

## 责任与范围

Runtime 负责普通 KernelClient RPC、内部取消/排空、实际依赖计数、清理结果和模块出口。Extra 负责停止自己的消息/HTTP 等业务准入，并通过 `onDispose` 等待自己启动的消费、保存和投递任务。宿主负责配置来源、数据库及退出顺序。

不增加保存协议、完成钩子、逐 Bot 控制、第二套 invoke 或通用业务 RPC。不要求业务手动调用 `client.invocations`。不恢复 launcher、依赖 IPC 或外部 Node 代启服务。SQLite 的创建、连接、迁移、事务和关闭全部归宿主，Runtime 仅调用注入函数。

# R01：统一规则和架构原则

修改 [engineering.md](../../rules/engineering.md) 的传输条款：保留 Kernel socket/pipe、worker stdio 和心跳合同；Extra 部分改为“生命周期由调用进程中的原生服务管理，业务依赖在同进程直接调用；可选 controlEndpoint 仅提供现有状态查询，不代理依赖、不代启服务”。

同步核对 [architecture.md](../../rules/architecture.md)、[extras.md](../../rules/extras.md)、[runtime-lifecycle.md](../../rules/runtime-lifecycle.md) 和 SDK 指南。旧任务/journal 保留历史事实；现行规则不得继续推荐旧代理或 runner。实施时将以下约束写入架构原则：

1. **业务准入、取消通知和依赖调用权限分开。** 停止新任务不等于立即撤销已有任务收尾所需的依赖权限；收尾必须有共同截止，清理结束或到期后撤销调用权限。
2. **公开迁移必须在实际发行包中成立。** 删除旧接入 API 时，为仍支持的内置模块保留公开接入路径；workspace 成功不能替代包外导入、构造和资源验证。

# R02：有界收尾

## 权限合同

保持现有 `ServicePhase`、`ExtraContext`、两阶段入口和依赖泛型，不增加公共模式字段或要求业务标记尾部调用。内部依赖权限独立于 owner signal；不能继续把 owner abort 直接等同于禁止全部宿主函数调用。

| 阶段 | 新 invoke / 新业务任务 | 依赖调用 |
| --- | --- | --- |
| 初始化、ready | 沿既有合同 | 允许，实际异步操作受现有 128 容量限制 |
| closing，插件清理未结束且未到期 | Kernel client 停准入；插件响应 signal 停止新任务 | 允许已有任务收尾，持续记录实际 Promise |
| 插件清理结束、到期或服务 closed/failed | 拒绝 | 在调用宿主函数前拒绝，不执行实际函数 |

通用依赖无法从函数名、参数或调用时刻识别调用用途。上述“已有任务收尾”是可信插件须遵守的生命周期合同，不是用途识别或沙箱保证。插件负责停止业务准入，框架负责 invoke 准入、时间和实际在途容量。

## 关闭顺序

1. 同步进入 closing，复用同一 close Promise，固定关闭截止。client 停止新 invoke 并立即启动所属调用取消/排空；随后通知插件停止新任务。取消意图不能等初始化结束才登记。
2. 复用 main #72 的 `shutdownDeadline` / `withShutdownDeadline`：Extra 服务全部阶段共用从停止起点继承的 4 秒单调时钟预算（早于原 5 秒上限）。初始化、dispose、依赖等待不得重置期限；初始化失败先由加载器回滚时，服务通过插件 signal 记住同一个截止。Kernel drain 的 epoch deadline 仅换算一次整数毫秒剩余额度。
3. 初始化进入可清理状态后，并发等待 Kernel 排空和插件清理。`onDispose` 等待业务消费者、保存和投递任务，再关闭插件自己的资源。不能先等全部 Run 排空才允许插件开始清理；执行连接须保留到收尾完成或共同截止。
4. 插件清理结束时关闭依赖权限；到期或初始化始终不结束时，也必须关闭权限。实际函数调用前检查权限及绝对截止，不能仅依赖 timer，以覆盖事件循环暂停后恢复的调用。
5. 权限关闭后，等待全部已开始的真实依赖 Promise，再形成最终资源结果。不能仅在取消时截取一次 pending 集合，否则会漏掉收尾中新启动的保存。操作未结束继续占额；后来 settle 不能把已返回的 incomplete 改成成功。
6. 关闭服务自建 client、日志和控制 socket。Run、插件或依赖任一未确认结束，返回 incomplete 和对应 pendingResources，保留冲突所有权；其他独立资源仍尝试清理。不得关闭共享 Kernel、兄弟 Extra 或宿主数据库。

signal 仍及时 abort，以停止准入、取消读取及触发 main 的清理流程。本次分离依赖权限，不延迟或删除取消通知。

## 实现位置与失败边界

- [extra-service.ts](../../../packages/octo-runtime-host-sdk/src/extra-service.ts)：拆分依赖权限和 owner abort；协调共享截止、并发关闭与最终实际依赖等待。
- [extras.ts](../../../packages/octo-runtime-host-sdk/src/extras.ts)：优先移除当前分支新增的阻塞式 `beforeDispose` hook，复用 main 的 close、逆序 disposer 和共享预算。初始化失败也须允许有界 disposer 收尾，服务最终等待实际依赖。
- [shutdown.ts](../../../packages/octo-runtime-host-sdk/src/shutdown.ts)：复用现有私有预算；不新增公开生命周期或业务接口。

SDK 不能强停已经开始的宿主函数，也不能回滚其数据库写入。超时后拒绝新函数调用，并报告仍在执行的操作；宿主根据 incomplete 决定处置，不能据此无条件关闭数据库。

实际 Promise 结束不等于业务保存成功。消费任务和 `onDispose` 必须保留依赖拒绝及业务失败；框架不解释任意业务返回值，不新增重试。取消 ACK、源终态、业务保存完成和 cleanup.complete 分别确认。

# R03：公开模块与实际发行包

新增 `@mininglamp-oss/octo-runtime/extras/channel-wecom` 和 `/extras/webui`。沿现有 Gateway facade 导出 `default`、`name` 及确实需要的公开依赖类型。`/extra` 保持通用合同，不增加渠道专用字段或模块加载器。

修改 `package.json.exports`，增加 `public/channel-wecom.ts`、`public/webui.ts`，同步 SDK 示例。禁止包外示例引用 private workspace 包、内部 node_modules、dist 私有路径或源码别名。三个 config-schema 出口继续保留。

扩展[包外 fixture](../../../test-support/public-extra/host.mts) 和[发行验证](../../../scripts/verify-release.mjs)：隔离 consumer 只安装本次实际 tgz，使用 strict、skipLibCheck=false 编译并运行三个模块。WeCom 用空 Bot 配置；WebUI 用临时本地端口和隔离会话文件，读取首页及其引用的脚本/样式，最终关闭 HTTP 服务。不得只验证类型或 import 成功，不触发真实外部鉴权和模型调用。

# 验收

以下均已按本轮代码验证；原 A16/A17 的旧测试和旧 tgz 验证不作为本轮证据。

| 编号 | 通过标准 |
| --- | --- |
| C01 | 现行规则/指南不再要求 owner 依赖代理；明确状态 socket、同进程依赖及宿主数据库边界 |
| C02 | 真实 Kernel invoke 在 close 后收到原取消终态；通过注入 saveTerminal 完成宿主写入；onDispose 等待写入后返回，complete=true |
| C03 | close 后新 invoke 被拒绝且无新增 Provider 执行；插件不接新任务；普通业务无手动登记/drain |
| C04 | Run 已终态而注入保存函数仍挂起时，close 不提前成功；保存结束后才成功，不以闭包布尔值代替依赖调用 |
| C05 | onDispose 内可调用依赖；关闭结束后调用捕获的依赖引用会拒绝，宿主函数计数不增加 |
| C06 | 初始化失败或中途取消时，disposer 可在剩余预算收尾；迟到初始化不能 ready 或重新开放权限 |
| C07 | 覆盖保存拒绝、永不结束及忽略取消：保留失败，未结束持续占额并阻止替换，迟到 settle 不改写结果 |
| C08 | 插件清理永不结束时，到期后的依赖调用也拒绝；各阶段不重置预算，重复 close 返回同一 Promise/结果 |
| C09 | 兄弟 Extra/无关 Run 继续，Kernel PID/instance 不变；宿主 SQLite 在 Extra 成功/失败关闭后仍可由宿主查询和关闭 |
| C10 | 隔离 consumer 仅装实际主包 tgz，通过三个公开模块出口严格编译、构造、initialize/status/close，无 workspace/私有路径依赖 |
| C11 | WebUI 首页及引用静态资源读取成功，close 后不再监听；WeCom 空配置不联网；现有 Schema 出口可读 |
| C12 | main #72/#73、CLI 原生 PID、生命周期回归及全部静态检查通过 |

用 Promise gate 和事件记录控制竞态，不用任意 sleep 假定业务已结束。截止测试使用现有预算机制；上界允许调度误差，但不得逐阶段重开预算。同进程同步阻塞不在 Promise 超时的强停保证内。

# 实施顺序与完成门槛

1. 补注入依赖收尾、关闭后拒绝、挂起依赖及包外模块导入回归，先确认当前实现按预期失败。
2. 实施 R02，验证有界写入、初始化回滚、失败所有权和兄弟实例隔离。
3. 实施 R03，构建并验证实际 tgz，覆盖 WebUI 静态资源和关闭。
4. 实施 R01，将合同同步回主设计、验收、架构原则和 SDK 指南；记录每项实际证据。
5. 执行 pnpm typecheck、lint、lint:names、format:check 和 test:suites；执行 node scripts/pack-release.mjs，再对生成的 dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz 运行 scripts/verify-release.mjs；执行 OctoSpec lint 与 git diff --check。

C01-C12 通过、三个评审项均有整改证据后，重新判断正式 PR 就绪。提交、远端 PR 和合并仍按用户授权执行。外部 Electron、真实 Provider/IM 和审查工具 issue-tracker 配置不作为本轮库内整改门槛。

# 本轮验收证据

| 验收 | 实际证据 |
| --- | --- |
| C01 | engineering 旧 owner 代理条款已删除；architecture 新增第 9、10 条原则；生命周期、Extra 规则及 SDK 指南同步 |
| C02-C04 | [真实 Kernel 回归](../../../test/host-sdk-lifecycle.test.js)：close 后新 invoke 拒绝；原调用收到终态后经过注入函数写入宿主 SQLite；Promise gate 挂起写入时 close 不完成，释放后成功 |
| C05-C08 | [依赖关闭回归](../../../test/extra-service-shutdown.test.js)：disposer 保存、关闭后调用、初始化失败/取消、保存拒绝、挂起 initializer/disposer/依赖、共享截止、重复 close、失败替换、实际容量及迟到 settle |
| C09 | 真实 Kernel 回归验证兄弟 Extra、无关 Run 和共享 Kernel 继续运行；依赖回归在成功/失败关闭后继续查询宿主 SQLite，最终由宿主关闭 |
| C10-C11 | [包外 fixture](../../../test-support/public-extra/builtin-extras.mts) 只从实际主包公开入口导入三个模块，strict/skipLibCheck=false 编译并初始化/查询/关闭；读取 WebUI 首页、全部引用 JS/CSS 及三个 Schema，关闭后 HTTP 连接失败；空 Bot 配置无外部连接 |
| C12 | 本轮类型、lint、命名、格式、全量测试、实际 tgz 和 OctoSpec 检查结果见[实施记录](implementation.md#评审整改验证) |

ExtraPlugins 已还原 main 实现，Core、KernelClient、调用登记、协议和三个内置 Extra 的执行源码未改动。未新增完成协议、手动登记要求或数据库所有权；函数 Promise 复用仍按每次调用独立计数，不能绕过 128 在途上限。

# PR #74 第二轮评审整改

基于 `134b98b`，纳入 Jerry-Xin 与 yujiawei 的 review。以下是本轮目标与验收，完成证据另记实施记录。

| 编号 | 问题与目标 | 验收标准 |
| --- | --- | --- |
| R04 | 初始化失败时，加载器等待 disposer 前就停止 invoke 准入并启动所属 Run 的取消/排空 | 真实 Kernel 中，initializer 启动未传 signal 的普通 invoke 后抛错；disposer 等待消费者并通过注入函数保存原取消终态；保留原始 cause、cleanup.complete=true、允许干净替换；共享 Kernel 与其他 Run 不受影响 |
| R05 | 原生 CLI 清理返回后，残留句柄不能让进程无限存活 | 仅前台组件 run 的可执行入口拥有最终退出策略：设定原返回码，250ms 后仍存活则退出；定时器 unref，正常退出不增加等待。实际 CLI 子进程覆盖挂起/拒绝的 disposer，SIGTERM 后有界退出 5；初始化失败也退出。SDK 与可导入 runCli 不终止宿主进程；数据命令输出须符合 R08 |
| R06 | Extra 控制 socket 的 bind 超过清理期限后仍必须被回收 | 明确记录 bind Promise；清理超时返回 incomplete、保留所有权，迟到绑定完成后自动关闭，不得发布 ready；确定性 gate 覆盖到期后 bind 成功和失败 |
| R07 | 核实 Kernel 绑定阶段取消是否漏关 | gate 暂停实际 listen，取消初始化后确认尚未报告清理成功；释放 bind 后应回滚关闭、释放端点且允许新服务构造。现有 startKernelServer 串行等待 bind 后检查取消并回滚，若测试成立则保留实现，不为推测增加状态 |

架构约束：初始化失败的取消不能等 disposer 完成；绑定中的资源也是所有权的一部分；超时结束等待不免除迟到回收责任，且不能把 incomplete 改写成成功。SDK 禁止退出宿主，CLI 可执行入口负责最终进程退出。所有阶段沿用原共享截止，不增加公共协议或业务手动 drain。

# PR #74 第三轮：CLI 慢管道输出

Jerry-Xin 对 `afeea70` 的新 review 指出，统一在所有命令结束后安装 250ms 退出 timer 会截断尚未刷新完的 stdout，且保留退出码 0。此问题成立，是第二轮 CLI 退出兜底作用范围过宽导致的回归。

R08 的目标是同时满足数据命令输出完整和前台组件有界退出。`runCli` 在既有参数解析及校验确认组件 `run` 后，通过 CLI 内部依赖通知可执行入口选择进程退出策略；该通知不表示 ready，不包含任何 SDK 或业务生命周期协议。`index.ts` 仅为此类前台命令安装最终退出 timer，普通数据、帮助、状态及部署命令沿 Node 自然退出，等待 stdout/stderr 写入，不按参数字符串猜测命令类型。

验收：真实 `extraget` 子进程导出含 700,000 字符、低于 1MiB 上限的有效配置，在 stdout 首次可读后暂停读取 800ms；最终字节与预期完整 JSON（含换行）完全一致、可解析、退出 0，stderr 配置路径仍正确。旧实现应复现截断。保留挂起/拒绝 disposer、初始化失败残留 timer 的实际 CLI 子进程回归，仍须有界退出 5。同步修正规则，不能将仅适用于服务进程的兜底推广到数据命令。

# PR #74 第四轮：依赖容器与异步拒绝核验

核对 yujiawei 对 `8430836` 的四项意见。R09：类实例依赖丢失方法成立，服务和 ExtraPlugins 都用对象展开，仅复制可枚举自有属性。目标是在同进程只读依赖快照中保留继承方法、非枚举成员、Symbol 成员，并将函数 this 绑定到宿主原对象，支持私有字段；不冻结或接管宿主实例。共享私有快照函数统一两处边界，原生服务在此基础上维持既有权限、128 实际在途、同一截止及失败所有权。值/访问器结果仍是构造时的浅快照，嵌套对象不递归代理，不增加通用对象 RPC 或沙箱。

验收：服务与直接加载器均接受继承类实例，方法能读取私有状态、宿主后续更新能由方法读取、非枚举与 Symbol 方法可调用、原对象仍可由宿主修改而注入视图不可替换。通过类实例异步方法在 disposer 中保存，挂起期间 close 不提前完成，关闭后捕获的方法被拒绝；类实例挂起操作仍受容量、截止和 incomplete 限制。实际主包 tgz 的 strict 包外 fixture 使用类实例注入宿主 SQLite 查询，数据库始终由宿主创建/关闭。

R10/R11：Extra 与 Kernel 的未处理拒绝说法需按实际 Promise 观察链核验。Promise.race 注册所有输入分支的拒绝处理器，胜出后不会移除落败分支观察；微任务间延后 catch 不等于 Node 已报告未处理拒绝。使用 --unhandled-rejections=strict 运行初始化失败、预先取消、中途取消、晚到失败及绑定竞态回归，保留原 cause/cleanup，不为未复现问题添加吞错逻辑。

R12：Kernel bind 漏关为 R07 重复意见。继续核对串行 await listen 后检查 signal、catch 中 teardown 的真实顺序，保留确定性延迟 bind 回归；若无反例，不改变已覆盖的 Kernel 实现。各项真实结果分别记录，不将一项成立扩展为四项均成立。
