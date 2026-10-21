---
type: Task
title: 宿主会话存储验收矩阵
description: 将 Issue 57 与 Issue 66 的验收落实到当前原生服务、真实存储及公共发行入口。
tags: [extra, lifecycle, channel, session, reset, storage, testing]
---

# 验收矩阵

下表保留验收合同；本轮实际结果见[实施记录](implementation.md)，不能将目标条件本身当作通过。逐项执行入口与风险见[可执行性评估](executability.md)；文档单列为[独立交付模块 D01–D10](documentation.md)，不以本表的一行摘要代替验收。

| ID | 可观察的通过条件 | 主要证据 |
| --- | --- | --- |
| A01 | 包外只安装主包，从 `/host`、`/extra`、`/extras/channel-gateway` 普通导入并推导依赖，无断言/私有入口，`skipLibCheck=false` 编译 | tgz 消费 fixture |
| A02 | 无关 Extra 自定义依赖并通过同一原生服务加载；共享 context/loader 不新增 Gateway/数据库字段 | 独立插件 fixture、声明检查 |
| A03 | 必需存储及其公开方法所需类型可命名；Gateway 专属类型不重复放入 `/extra`，实际发行 exports 与 verifier 一致；Runtime 不新增 SQLite 依赖或适配实现 | 声明依赖、发布名及依赖图检查 |
| A04 | 真实 Extra 接线实际调用工厂；read/save/reset/occurrence/remember 均落到宿主实现 | 带操作计数的宿主 store 替身、消息输入及回复，不引入 SQLite |
| A05 | 卸载完整后由宿主关 DB、重开同一文件、重建 Extra，恢复相同 agentSessionId 和可恢复 Provider binding | 宿主仓库的 SQLite 集成测试 + 真实 Gateway；库内替身复用不作为落盘证据；fake 与真实 Provider 分别记录 |
| A06 | 不同 Bot、组织、助理、用户、聊天及 topic 不串绑定；同一 Bot 的不同可信 scope 通过关闭后重载分别验证，不能在同一 Manager 中重复身份模拟两个 Bot | scope 表记录及恢复输入；同 scope 重开可恢复，改变任一归属维度不命中 |
| A07 | 每个启用有效 Bot 一次工厂；无效/禁用不分配，配置快照保留未知 scope 字段；宿主修改快照不改变 Runtime 配置 | 工厂次数、双向变更断言 |
| A08 | `/reset`（以及既有 `/new`）按控制 ID 幂等、generation 增加，下一轮新 session；旧代次写入不污染新 binding 和其他聊天 | 库内替身 reset、迟到 session.update、规则/gap 竞态；宿主事务语义另验 |
| A09 | `patchGap/invalidateRules/patchRules` 全部实际转发且保留 this；无可选方法保持既有 unknown/每轮规则策略 | 宿主类实例 store、GROUP.md 和历史专项回归 |
| A10 | remove/upsert 先完成旧 Runtime 与句柄清理，再分配新句柄；清理失败及超时工厂调用次数不增加 | Manager 顺序追踪和故障注入 |
| A11 | 初始化抛错、挂起、owner 在创建中关闭均登记并尝试释放已取得资源；截止时未释放则 incomplete，禁止迟到访问并保留未完成所有权 | 原生服务初始化取消与回滚；不能将撤权算作已释放 |
| A12 | 正常终态、owner abort 与 caller cancel 分别符合共同合同；尾 session.update/规则保存先于句柄 close，原事件流不被提前截断 | 实际 Kernel IPC + 原生 Extra + Gateway + 可追踪宿主 store 替身 |
| A13 | 终态后展示、卡片及 final 挂起时句柄/连接不提前释放；Gateway 策略不影响其他 Extra | 复用 Gateway drain 测试并追加句柄顺序 |
| A14 | cancel ACK 丢失/拒绝、断流、缺终态、lost、观察提前 return 按既有合同保留真实结果；不重新 invoke 或以 ACK 冒充终止；拒绝取消但已确认终态的用例不一律判失败 | Kernel 与 Gateway 故障回归，同时核对终态与控制错误事实 |
| A15 | 超时共用原生服务 4 秒预算、Gateway drain 最多 3 秒，不按 Bot/阶段累计；到期不再进入宿主读写 | 屏障验证共享绝对截止和调用计数；真实计时只作有界等待冒烟，记录调度容差，不声称能中断同步阻塞 |
| A16 | 包装层逐方法注入异常验证原错误与失败记录；真实 draining 可达的尾写异常到达最终 incomplete；close throw/reject/不结束同样阻止替换 | 方法级故障表与实际服务收尾两层测试；不在停准入后发起新 reset 来伪造 drain 用例；私密错误不外泄 |
| A17 | 工厂抛错、非对象、缺方法、无效可选方法及错误 Promise 工厂明确失败，无 Memory 回退；迟到句柄被回收且无 unhandled rejection | 真实入口和 strict 子进程回归 |
| A18 | 工厂句柄提供 close 时实际调用恰好一次，未提供时仍完成撤权；直接 sessions 不被 close；Memory 自有实例关闭；sessions+工厂在内部可组合入口冲突时显式拒绝 | 所有权计数；不为测试内部冲突新增公共 sessions 参数 |
| A19 | 关闭/切账号后旧 callback 不能写；宿主 DB 仍可被其他业务使用，兄弟 Extra、共享 Kernel 与无关 Run 正常 | 新旧 scope、共享数据库和真实 IPC 隔离 |
| A20 | 句柄撤权与实际资源释放区分；迟到清理不能把已有失败结果改成成功 | 重复 close 与延迟 settle |
| A21 | CLI 仍原生构造同一服务，未注入工厂时默认 Memory 正常；SDK 文档独立通过 D01–D10 | CLI 默认行为回归；文档概念、装配、可运行样例和真实宿主证据分别验收 |
| A22 | build/type/lint/names/format、全仓测试、包外发行检查与 OKF 检查通过并记录跳过 | 新基线本轮检查输出 |
| A23 | im-test 上真实进程/DB 重启后续聊、reset、关闭和恢复失败策略可观察 | 测试环境记录，不含凭据 |
| A24 | 能力合入 main 后，Buddy/Electron submodule 更新到验收当时最新远端 main，记录 SHA/lockfile，重跑恢复与切账号；若另有 npm 消费方再验其实际发布版本；平台逐一记录通过/待验 | 消费方 main 指针、Electron/Node/驱动版本和运行记录；Node fixture 不代替 Electron，待验不算通过 |

A01–A22（除 A05）与 D01–D08、D10 是库内实现、文档和发行合同门槛；A05/A23/A24 与 D09 是宿主数据库、真实集成及消费方交付证据；D07 的工厂 main 可用性须合入后再验，合入前只验接入准备。文档门槛不因代码测试通过而免除；无账号或 Electron 环境不阻塞库内实现，但不能关闭完整业务验收。每项记录本次基线、命令/场景、结果及证据位置，不得用旧 PR 的测试数量或 mock 通过代替。
