---
type: Reference
title: 宿主会话存储计划的逐项可执行性评估
description: 根据当前 main 的实现和测试入口评估 24 项验收，补齐文档模块、测试分层及宿主数据库责任。
tags: [architecture, extra, lifecycle, channel, session, storage, testing]
---

# 评估结论

本文保留实施前的规划评估；后续实际代码、文档和测试结果见[实施验收](implementation.md)，不将当时的未执行描述作为当前产品状态。

修订后的计划具备开始实现的条件；当前没有需要改变产品方向才能开工的阻断。主要工作在逐 Bot 句柄所有权和关闭失败传播，不在增加数据库功能。文档是独立模块，完整 SDK 交付还依赖宿主真实数据库、Electron、Provider 和能力合入 main 后的验证。

“可执行”表示实现入口、场景及通过条件已经明确，不表示代码已经完成或测试通过。本轮只核对源码、测试脚手架与计划，未执行产品测试。按用户最新约束，整个 octo-runtime 不依赖 SQLite；库内新增测试/样例使用存储替身，SQLite 适配和真实落盘验收在宿主工程。

## 原稿缺口与本轮修正

| 原稿缺口 | 对交付的影响 | 修正 |
| --- | --- | --- |
| A21 将概念、API、源码接入、样例和 Electron 混在一行 | 文章写完容易被误算为接入通过 | 拆为独立 [D01–D10](documentation.md)，规定文档文件、读者问题、样例和验证方法 |
| 示例依赖未提供的 host-storage.js，且有 declare const | 读者无法复制运行；没有证明新公共类型可用 | 保留为明确标注的宿主示意；另要求完整、无 SQLite 依赖的包外加载 fixture |
| M2 直接安排迁移 PR65 的 SQLite 测试 | 将宿主数据库责任带入 Runtime 任务 | 复用接口场景断言，库内使用替身；A05 真实数据库恢复归宿主 |
| A11 将超时撤权写成资源必定回收，A16 将全部写操作都写成 drain 场景 | 可能出现不可能通过或靠假场景通过的测试 | 超时保留 incomplete/未完成所有权；方法级故障与真实尾写集成分层 |
| 同 Bot 不同 scope、可选 close、时间容差的条件不完整 | 实现者可能新增无必要 API 或用不稳定等待验收 | 同 Bot 改用完整关闭后重载；close 存在才计次；屏障/绝对截止断言优先 |
| A24 要求 Buddy 依赖发布版本 | 与用户指定 submodule 最新 main 不一致 | 源码消费方按 main SHA 验收，npm 消费方独立验实际发布版本 |

## 每个验收点如何执行

“直接执行”表示可按既有入口实现并测试；“重点验证”表示合同明确，但竞态/错误传播是实现风险，需要先做最小实验；“宿主条件”表示库内证据不足以关闭该项。状态均为未验收。

下表的新文件名称是拟定落点，不表示文件已经存在。

| ID | 可执行性 | 实现或测试入口与具体判定 |
| --- | --- | --- |
| A01 | 直接执行 | 扩展 test-support/public-extra 与 scripts/verify-release.mjs；现有 verifier 已用 strict 和 skipLibCheck=false。新增工厂普通导入和推导、运行真实 Extra，不能只复用现有 bots: [] 的成功。 |
| A02 | 直接执行 | 复用 public-extra/host.mts 的无关 BusinessDependencies 与 extra-dependency-container 测试；保留自有依赖和类方法 this，检查共享入口未增加业务字段。现有宿主 fixture 并非 Gateway 存储覆盖，本任务新用例不需要 SQLite。 |
| A03 | 直接执行 | ports.ts、index.ts、public/channel-gateway.ts；从 ImSessionStore 追踪所有引用类型，列明业务入口或 protocol 的导出位置。编译一个完整宿主实现并审查声明闭包/exports，防止漏导出 gap/rules/快照类型。 |
| A04 | 直接执行 | 拟新增 test/gateway-host-session-store.test.js；用真实 Extra/Manager/Runtime 和计数 store 替身，投递消息、重复消息及 reset，核对五个必需方法实际调用，显式工厂路径不得创建默认 Memory。 |
| A05 | 宿主条件 | 宿主仓库实现 SQLite 适配，干净关闭后重开文件并重建 Gateway；比对原逻辑和 Provider binding，再核对下一轮输入。库内相同 Map 后端的新句柄仅验证重新读取，不证明文件持久性。真实 Provider 续接还需 A23。 |
| A06 | 直接执行 | 在 A04 fixture 用带记录的 scope 后端逐维改变 Bot/org/assistant/user/chat/topic；同一 Bot 身份使用完整关闭后重载，不凭重复 Manager key 伪造隔离；宿主 SQL 隔离由 A05/A24 再证。 |
| A07 | 直接执行 | configuration.ts 与 manager.ts；参数化有效/无效/禁用 Bot、未知扩展字段和嵌套对象变更，断言工厂次数及工厂快照与 Runtime 配置互不污染。 |
| A08 | 重点验证 | 复用 im-session-store 及 reset/规则/gap 专项，使用屏障让旧代次更新晚于 reset；断言重复控制 ID、下一轮新身份及旧写拒绝。区分 Gateway 的代次判断与宿主实现的原子更新责任。 |
| A09 | 直接执行 | 新 host-session-store.ts 包装层方法表测试，使用含私有字段的类实例验证 this；可选方法存在/缺失两组，结合 GROUP.md/gap 行为，不能只断言函数被调用。 |
| A10 | 重点验证 | manager.ts endpoint 记录及原生 close；记录 old-drain、old-close、new-factory 序列，分别注入旧清理失败和超时，确认不增加工厂计数且保留旧失败记录。 |
| A11 | 重点验证 | extra-service-shutdown 与 Manager 初始化 fixture；在取得句柄前后、Runtime.start 挂起时关闭，证明已登记资源被尝试清理；未完成须可追踪，撤权后访问计数不增加。 |
| A12 | 重点验证 | gateway-runner-drain/extra-service-shutdown 与实际 Kernel IPC；owner、caller、正常终态分别测试，核对最后一次 binding/rules 保存先于 close。用宿主替身观察顺序，不混入数据库驱动变量。 |
| A13 | 重点验证 | gateway-shutdown-drain 的展示/卡片/final 阻塞点加句柄追踪；终态不等于业务收尾结束，截止前不提前释放。运行无关 Extra 对照，证明业务等待策略未进入共享 loader。 |
| A14 | 直接执行 | kernel-invoke、kernel-invoke-lifecycle、kernel-invoke-consumers 保留现有控制语义，Gateway 补终态/清理结果断言；不同 ACK/终态组合分别断言，不统一改为成功或失败。 |
| A15 | 重点验证 | 共享 shutdownDeadline，两个以上 Bot 和挂起 close 的屏障；证明各层继承同一绝对截止、到期调用被拒绝，整体不逐层延长。真实耗时测试写明调度容差；同步阻塞不属于 timer 可强制中止范围。 |
| A16 | 重点验证 | 包装层逐方法 throw 与 Runtime 真实尾写错误两层；即使业务捕获错误，Extra 最终 cleanup 仍 incomplete。另验 close throw/reject/hang、重复关闭及脱敏。 |
| A17 | 重点验证 | 工厂有效性校验和 strict unhandled-rejections 子进程；覆盖 throw/非法对象/非法方法/误返 Promise。使用受控 Promise 验证晚到句柄一次释放、晚拒绝被消费及无 Memory 回退。 |
| A18 | 直接执行 | owned/borrowed/default 三组计数；可选 close 缺省仅撤权，有 close 时调用一次。冲突仅在内部可组合依赖入口测试，不扩大公共 Gateway 参数。 |
| A19 | 重点验证 | 旧 callback 屏障 + 两个 Extra/共享 Kernel；切 scope 后旧写被拒绝，新 scope 正常，宿主替身后端仍可被其他业务读写。真实共享 SQLite 连接在宿主侧重复该场景。 |
| A20 | 重点验证 | 延迟 close 与重复 close 返回值；分别观察访问撤销、真实 Promise settle、先前 incomplete 不变。不得用清空 Map 充当资源释放证据。 |
| A21 | 直接执行 | CLI 空 dependencies/default Memory 回归，加独立 D01–D10 文档记录。CLI 不增加 SQLite 配置、驱动或自动建库。 |
| A22 | 直接执行 | 执行 plan.md 所列构建、全量测试、命名/格式/类型、测试 tgz、OKF；记录基线和跳过。dirty 测试包可验证行为，但不能据此宣称干净提交的正式发行校验通过。 |
| A23 | 宿主条件 | im-test 真实消息 + 宿主持久 store + 真实 Provider；现有 verify-gateway-drain-live.mjs 可复用账号/投递检查，其 fake adapter 不能证明真实 Provider 续聊。扩展宿主验收步骤并单独记录 Provider 版本、恢复成功和失败策略。 |
| A24 | 宿主条件 | 能力合入 main 后在 Buddy/Electron 消费工程按最新 main 更新 submodule，固定已验 SHA 和 lockfile，实际重启/切账号；记录各平台与 Electron/Node/驱动版本，不把 Node 24 fixture 当作任意 Electron 可用。 |

## 先验证什么

先完成 M0 的包外类型闭包和 M1 的最小闭环：真实 Gateway 调一次宿主工厂，尾绑定保存后关闭句柄；再证明清理失败时不能创建替代句柄。这个闭环同时验证业务入口、真实消费及所有权，最能提前暴露错误方向。

随后补齐 reset/gap/rules、初始化和取消竞态，再扩大到多 Bot/共享 Kernel 和全量发行检查。D01–D03 与 M0 同步，D04–D06 随对应实现验证，避免最后才发现文档接口无法使用。

库内工作可以先执行；完整交付尚需宿主消费工程、实际 SQLite 适配和测试环境、真实 Provider 账号/版本及合入 main 后的 SHA。这些是外部验收前提，不应通过向 octo-runtime 添加数据库实现来解决。未满足前提的项目保持待验，不能以库内通过数量折算为整体通过率。

## 本轮证据范围

依据 main 基线 `0c1d1c9` 的 Manager、session-store、公共 exports、public-extra fixture、发行 verifier 和现有生命周期测试源码评估。24 项均已映射执行入口；文档增加 10 项独立验收。这里只形成计划及文档修订，产品实现、产品测试、真实数据库和 Electron 联验均未完成。
