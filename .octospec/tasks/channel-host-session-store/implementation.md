---
type: Task
title: Gateway 宿主会话存储实施与验收结果
description: 记录实际接线、句柄所有权、存储无关样例及库内验证，真实宿主验收由用户在 main 合入后执行。
tags: [extra, lifecycle, channel, session, storage, testing]
---

# 实现范围

基于 `main@0c1d1c9` 实现，用户已明确授权提交并合入 main，随后自行执行真实测试。未直接 cherry-pick #65，也未恢复旧 daemon/LocalExtras 执行路径。

- Gateway 自己定义 GatewayDependencies/CreateSessionStore，经真实 Extra initializer 传给 Manager；公共类型只在 `/extras/channel-gateway`，通用 `/extra` 和 Host SDK 加载器没有新增业务字段。
- Manager 先登记 endpoint，再调用同步工厂；为启用有效 Bot 提供独立配置快照，保留未知可信 scope 字段。Factory 抛错、无效对象、错误 Promise 均不回退 Memory；初始化失败回收已取得句柄。
- HostSessionStore 保留全部必需/可选方法及原始 this，沿用已有 Runtime 的尾写顺序和最早单调关闭期限；完成或到期后撤权，再调用可选 close 一次。实际操作失败及未完成释放保留 incomplete，阻止替换；迟到创建继续回收且不改写原失败。
- 默认 Memory 和直接 sessions 借用语义保留。整个 Runtime 不增加 SQLite 依赖、适配、表结构或迁移；新增测试和样例均不依赖 SQLite。宿主自己选择数据库并执行事务、容量、保留和共享连接关闭策略。
- 两篇根目录 SDK 指南、Gateway README、Extra 指南和规则同步方法语义、主进程装配、错误处理、存储内容及最新 main 的 submodule 步骤。宿主 SQLite 节选明确标示意；可运行样例单独链接完整受测文件。

## 功能验收证据

新增 [gateway-host-session-store.test.js](../../../test/gateway-host-session-store.test.js)，结合现有 Gateway/Kernel/Extra 回归。下表“库内通过”仅指相应合同的自动化/静态证据，不代替宿主真实存储或 Provider。

| 验收项 | 结果与证据 |
| --- | --- |
| A01/A03 | 包外测试 tgz 的 strict、skipLibCheck=false 编译及真实 Gateway 工厂加载通过；业务类型闭包在公共入口，未改通用 `/extra` 或 package exports，未新增 SQLite 包依赖。 |
| A02 | 发行 fixture 的无关 BusinessDependencies 和全仓 extra-dependency-container 回归通过，通用服务没有 Gateway 分支。 |
| A04 | 真实 Gateway 消费工厂并实际调用全部必需读写，计数断言通过；后端为测试宿主所有。 |
| A05 | 待用户宿主测试。库内只证明关闭重载后从同一宿主后端重新读取逻辑及 Provider binding，不证明 SQLite 文件持久性。 |
| A06/A07 | Bot/org/assistant/user/chat/group/topic 隔离与同 scope 重载、有效/禁用/无效 Bot 工厂计数、扩展字段及双向配置变更隔离通过。 |
| A08/A09 | 工厂路径 reset 重放幂等、新代次身份、旧代次 gap/rules patch 拒绝通过；全部可选方法保留 this/缺失语义，既有 GROUP.md/gap/reset 竞态回归通过。 |
| A10 | remove/upsert 清理先于新工厂；close throw/reject/挂起均阻止替换，重复清理保留同一失败通过。 |
| A11 | Runtime.start 失败回收并可干净重试、原生初始化中取消、工厂重入关闭、错误 async 工厂迟到回收通过。 |
| A12 | 真实 Kernel IPC + 原生 Gateway + 宿主句柄证明尾写/最终回复先于句柄释放；既有 Kernel owner/caller cancel、控制及尾流回归通过。 |
| A13 | 终态后 presentation/final 挂起时工厂句柄不提前关闭；Gateway 既有卡片/最终展示失败与无关 Extra 回归通过。 |
| A14 | 复用全仓 Kernel invoke 的 ACK/断流/终态/观察关闭合同；未修改共享执行语义，没有重新 invoke 的恢复路径。 |
| A15 | 多 Bot 共享短绝对截止、未完成 close 均被尝试、到期读写在进入宿主前拒绝通过；不承诺抢占同步阻塞。 |
| A16 | 包装层逐方法 draining throw 保留原异常与失败事实；真实原生尾 save/remember/close 失败使服务 incomplete，并拒绝同名新服务通过。 |
| A17 | 非法对象/方法、工厂 throw、误返 Promise、迟到 reject/handle 以及 getter 异常回收通过；专项使用 strict unhandled-rejections。 |
| A18 | 工厂可选 close 一次、无 close 撤权、直接 sessions 不关闭、内部工厂冲突拒绝和默认 Memory 路径通过。 |
| A19 | scope 改变后隔离、句柄撤权后不可进入宿主、共享后端保留、真实 Kernel 兄弟 Run/执行可用性通过；真实共享 SQLite 另待用户。 |
| A20 | 迟到释放不把既有 incomplete 改成功；重复 close 及失败所有权保留通过。 |
| A21 | CLI 既有空 dependencies 路径保留，完整发行 fixture 同时验证默认与注入；文档结果见下表。 |
| A22 | 构建、类型、lint、格式、命名及全仓测试通过；离线测试 tgz 验证通过。最终干净提交包与托管 CI 在提交后核对，不以 dirty 包冒充正式发行。 |
| A23/A24 | 待用户合入 main 后在 im-test/真实 Provider、Electron/Buddy 自有 SQLite 和各平台测试。未发布 npm。 |

## 文档交付证据

| 验收项 | 结果与限制 |
| --- | --- |
| D01 | 概念说明和两篇 SDK 指南已说明 binding/准备游标/occurrence/reset 去重、默认内存、持久恢复收益及 Provider/Run 限制。 |
| D02 | 接口中文注释及 SDK 方法表覆盖所有必需/可选方法、未命中、同步/异步、原子性、代次、错误与关闭所有权。 |
| D03 | 业务入口和泛型依赖边界有公共导入示例、加载链和包外编译证据，store 无需注册独立 Extra。 |
| D04 | [完整存储样例](../../../test-support/public-extra/gateway-store.mts)与既有 host/worker 启动代码由实际发行 verifier 编译并运行，未引入 SQLite。 |
| D05 | SQLite 明确归宿主实现，指南列出同步合同、可信 scope、事务、保留和共享连接责任；不提供 Runtime 数据库适配。 |
| D06 | SDK 节选包含初始化错误后的 close、Bot errors 状态检查和完整关闭要求；库内测试验证尾写/展示/最终回复/句柄释放顺序及 incomplete。 |
| D07 | 文档规定首次/已有 submodule 跟踪最新 main、记录 SHA/lockfile，并说明源码包名与发行入口。合入后实际 main 可用性和宿主升级由用户验收。 |
| D08 | 数据库片段标“宿主实现示意”；完整运行命令指向受测 fixture。OKF 文件链接、类型和运行分别验证，不混算。 |
| D09 | 待用户真实 Electron/Buddy/SQLite 验收，不用 Node fixture 推断驱动兼容性。 |
| D10 | 任务、指南、规则及本记录区分实现/库内证据/宿主待验。提交合并和 CI 的最终状态以实际 GitHub PR 为准。 |

## 运行记录

- `pnpm typecheck`：通过。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`：通过。
- `pnpm test:suites`：本轮最终结果在 journal 记录，包含 Node 与 UI，保留条件跳过。
- `node --unhandled-rejections=strict --test test/gateway-host-session-store.test.js`：通过；新增展示/最终回复保持用例后由全仓测试再验。
- `node scripts/pack-release.mjs` 与 `node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz`：通过；输出含 publicTypes、builtinExtras、gatewayHostStore、nativeKernel 和 offlineInstall。

合入前不关闭完整业务验收；用户明确选择先合入主分支，再执行真实宿主测试。上述测试没有使用真实 IM/Provider 凭据，也没有修改消费方数据库。
