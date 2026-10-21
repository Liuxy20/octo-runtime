---
type: Task
title: 宿主会话存储的 SDK 文档交付与验收
description: 将概念定义、接口语义、加载步骤、可执行样例和宿主集成作为独立模块验收，SQLite 完全归宿主。
tags: [extra, channel, session, storage, testing]
---

# 文档是独立交付模块

本文保留文档验收合同，实际结果见[实施记录](implementation.md)。概念说明、方法合同和可运行包外样例已提供；宿主真实 SQLite/Electron 及 main 合入后的消费验证单列。不能将“Markdown 已更新”算作 SDK 接入已验收。

整个 octo-runtime 不依赖 SQLite，不提供 SQLite 适配实现、驱动、表结构和迁移。库内样例实现不依赖 SQLite 的宿主 store 测试替身，用来展示接口和插件加载；Electron/Buddy 在自己的仓库实现数据库适配并执行真实 SQLite 验收。SDK 文档不要求用户安装 Runtime 提供的数据库插件。

## 验收项

| ID | 交付位置与内容 | 执行方法及通过条件 |
| --- | --- | --- |
| D01 概念与价值 | [概念说明](session-store-explained.md)、根目录 Gateway 指南 | 读者可回答：store 存什么、谁读写、默认 Memory 是否落盘、何时选宿主持久化、为什么不是完整聊天历史/未完成 Run 恢复。表中覆盖 binding、准备状态、occurrence 文本/快照、reset 去重及保留责任；用一次重载续聊和一次 reset 举例，标明 Provider 可恢复的前提。 |
| D02 方法合同 | Gateway 接口就近中文注释、Gateway README 的方法表 | 每个必需/可选方法写明输入、返回值、未命中、同步/异步、错误、修改范围和原子性要求。说明 reset 控制 ID 幂等、generation、旧代次拒写、patch 的身份校验与 false、可选方法缺失的退化语义、close 所有权；宿主不需读私有 Runtime 代码即可实现接口。逐行与接口及对应测试对照。 |
| D03 类型与依赖边界 | 两篇根目录 SDK 指南、公共入口说明 | 图示/步骤解释 config 与 dependencies、模块与 store 的区别；Gateway 业务类型来自 `/extras/channel-gateway`，通用类型来自 `/extra`，store 不作为独立 Extra 注册。核对公共类型清单及包外普通导入，不出现私有路径、强制断言或通用 loader 的 Gateway 分支。 |
| D04 可运行加载样例 | 拟新增 `test-support/public-extra/gateway-store.mts`，接入现有发行 verifier；指南链接其代码 | 给出完整的宿主 store 替身、配置构造、Kernel/worker fixture、initialize/status/close 和运行命令。只安装测试 tgz 可编译运行，覆盖默认 Memory 与注入两种路径；工厂有调用计数，store 所有方法有合同测试。不依赖 SQLite，不用缺失的 `host-storage.js` 或 `declare const` 冒充可运行项目。 |
| D05 宿主数据库适配指南 | 根目录 Gateway 指南的宿主实现章节 | 说明 Electron 主进程自有数据库如何返回逐 Bot 句柄、同步方法要求、可信 scope、reset/patch 的事务边界、读写快照隔离及保留策略。SQLite 片段必须标“宿主实现示意”，列出宿主需提供的函数；不声称有现成 SDK SQLite 实现。其真实实现和驱动兼容性由 D09 验证。 |
| D06 加载/关闭/失败流程 | 两篇指南与 D04 样例 | 操作步骤包含初始化失败的 finally 清理、正常停机、切账号、close incomplete 和工厂错误。用顺序断言证明停准入→必要尾写→撤权→句柄 close；宿主等所有数据库使用者结束再关库。说明未完成不能直接重建；样例可观察这些结果，不能仅打印“成功”。 |
| D07 main 源码接入 | 原生 SDK 指南第 0 节 | 在独立消费工程验证首次添加与已有 submodule 两组命令；`.gitmodules` 跟踪 main，主动升级时 SHA 等于 fetch 后的 origin/main，宿主记录 SHA/lockfile，CI 复现该指针。区分源码 workspace 包名和主发行包入口。工厂合入前保留待实现标记，不要求切功能分支。 |
| D08 样例与文字一致 | 两篇 SDK 指南、Gateway README、Extra authoring 指南、概念说明 | 每个代码块标明“可运行/节选/待实现/宿主示意”。可运行部分来自受测 fixture，节选须指向对应源文件和启动前提；人工核对方法名/关闭结果/同步语义及所有本轮新增章节锚点。OKF lint 只验文件链接，不能代替 TS 编译或锚点检查。 |
| D09 Electron 宿主实证 | Buddy/Electron 仓库中的适配实现和集成记录，Runtime journal 引用证据 | main 合入后用真实宿主 SQLite 完成 A05/A24，记录 main SHA、Electron/内置 Node/驱动版本、启动命令和脱敏结果，证明重开、切账号、reset 及共享 DB 所有权。Node 测试替身和文档示意均不算 Electron 通过；未具备宿主工程/环境时标待验。 |
| D10 交付状态及维护 | 任务 context、journal、规则与指南状态标记 | 实现前以目标合同描述；实现后逐项登记基线/命令/通过或失败/待验原因。能力尚未合入 main 时不能宣称 main 已可用；规则仅在相应实现验证后更新。整套交付结论明确本地门槛与宿主门槛。 |

## 编写顺序与完成定义

1. M0 同步完成 D01–D03 初稿，先让接口作者和宿主接入者对数据及所有权有同一理解。
2. M1/M2 实现时完成 D04/D05；样例只演示 Runtime 的存储无关合同，数据库适配属于消费方工程。
3. M3 完成 D06 的错误和停止场景，用已验证顺序修正文案。
4. M4 对 D04 做包外严格编译和运行，完成 D08；D07 在能力合入 main 后以真实 main 验证最终可用性，提前只能验证现有接入命令。
5. 宿主执行 D09；D10 如实记录仍待验的主分支接入、平台与 Provider 条件。

库内文档完成要求 D01–D08、D10 都有对应证据；其中 D07 的工厂 main 可用性是合入后的交付检查，合入前只能标准备完成。整体 SDK/Electron 交付还要求 D09。文档评审和代码测试各自有结论，不能互相替代。
