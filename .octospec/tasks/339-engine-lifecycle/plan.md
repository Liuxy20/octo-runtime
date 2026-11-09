---
type: Plan
title: Issue 339：实施、架构文档与验收计划
description: 以可核对的阶段拆分常驻 Engine 所有权改造，记录代码落点、文档交付和显式本地验收。
tags: [architecture, lifecycle, documentation, testing]
---

# 阶段计划

已按授权实施 M0-M3，并进入 M4 验证、code-review 与同类问题子 review/autofix。表格保留阶段出口条件，实际通过与未验项目写入[验证](validation.md)。

所有阶段必须保留自定义 Adapter 的任意构造方式。M0/M3 通过 A16 核对 Codex 专用接口和 CLI manifest 约定没有成为 SDK 通用限制。

| 阶段 | 修改落点 | 出口条件 |
| --- | --- | --- |
| P：规划与文档 | 本任务文件、架构规则、双语 docs 架构、知识索引和 journal | 目标/现状分开；模块对象表、Home 权属、关闭顺序、95 分自评及文档检查完整 |
| M0：固定可实现接口 | Codex service.ts、app-server.ts、index.ts 依赖盘点；新增包内 provider 合同 | 结构化 channel/lease 不依赖具体 CodexService/ChildProcess；可用业务假 provider 实现；共享关联器、配置视图和 Home 冲突输入已定义 |
| M1：提取托管模块 | Codex 服务池/监督模块、Adapter scope、Adapter SDK 的相关注释与 cleanup 语义 | Adapter 只 acquire/release；owner 独立持有 supervision/close；同配置复用、不同配置隔离、无重放仍成立 |
| M2：宿主装配 | CLI adapters.ts、manifest.json、main.ts、playboard.ts、foreground 清理；Kernel/Core shutdown 与 status 相关最小修改；public/codex.ts | run 与 Playboard 均显式持有托管 owner，部分初始化失败可回收；借用 scope 不关闭共享 Engine；default manifest 与已支持工厂路径明确迁移 |
| M3：SDK 与架构文档同步 | 双语 docs、examples、包 README、根架构导航、octospec rules | 包外 SDK 仅使用公共导出即可构造两种路径；模块/对象表对照最终实现更新，不遗留“待实现”冒充当前的描述 |
| M4：验证与交付记录 | test/manual 显式专项、现有受影响回归、validation、review、journal | 下列验收分别有实际证据；未验平台单独记录；相对目标分支无 CI 扩围 |

## docs 必交付范围

1. `docs/{zh-CN,en}/concepts/architecture.md`：逐模块写出职责、持有对象、创建者、最终关闭者和借用限制；解释 Runtime IPC 与 Engine transport、Engine 与 Home 的独立生命周期。
2. `docs/{zh-CN,en}/concepts/module-loading.md`：解释构造参数可不同，统一的是注册执行合同；manifest 只归 CLI，不引入通用 Engine 注册平台。
3. `docs/{zh-CN,en}/getting-started/{sdk,cli}.md`、`docs/examples/`：默认托管、业务自管接入，以及正常退出/初始化失败/超时收尾；CODEX_HOME 由宿主注入。
4. Codex、Core、Kernel、Adapter SDK、Host SDK 的双语 README 与公开入口注释：按实际改动更新，明确 scope、lease 和 owner 各自 close 的范围。
5. 根 `ARCHITECTURE.md`、`INTEGRATION.md`、`DEPLOYMENTS.md` 和 docs 导航：核对指向当前双语正文，避免保留另一套相互矛盾的所有权说明。
6. `.octospec/rules/{architecture,runtime-lifecycle,adapter-metadata,local-execution}.md`：实施后消除“Provider 进程一律归 Adapter”的过度概括；保留其他逐轮 Adapter 现有职责。本轮同步实施后的合同，历史 #313 验证记录不改写。

## 实施验收矩阵

| 编号 | 场景及可观察通过条件 | 证据层级 |
| --- | --- | --- |
| A01 | 默认 CLI 无新所有权配置必填项；首次调用启动、后续同配置复用 PID/initialize，stop 最终回收 owned 进程 | 现有回归、手动真实 CLI |
| A02 | 显式托管 SDK 通过公共导出装配；正常关闭及 Kernel 初始化失败均关闭自己创建的 owner，保留独立 cleanup 事实 | 本地 fixture、包外 tgz |
| A03 | 业务预建 Engine 注入不额外 spawn；关闭 Runtime A 后 Engine 与 Runtime B 仍可调用 | 共享 provider fixture、真实 Codex 独立专项 |
| A04 | 一轮完成、取消、iterator return、client 断开各保持原语义，不结束健康共享 Engine；定向取消只作用原调用 | 现有回归、交错调用专项 |
| A05 | acquire 中取消或 scope 关闭后迟到返回会 release；不取消共享启动，不发布迟到活动调用，不影响 B | 可控 barrier fixture |
| A06 | owned 空闲/活动故障按既有预算恢复；borrowed 故障不由 Adapter 重启；无自动重放，旧 lease/交互被拒绝 | 手动故障 fixture、真实服务 |
| A07 | executable/cwd/env/MCP/revision/流限额不同按兼容规则隔离；业务 provider 不支持的配置明确拒绝；旧 providerSession 不误续接 | 配置及会话回归 |
| A08 | 宿主显式 Home 正确送入 Engine；SDK 缺少 CODEX_HOME 不回退 ~/.codex；CLI 默认选择仍在宿主执行；冲突覆盖拒绝 | 显式环境 fixture、包外 SDK |
| A09 | cancel、restart、Kernel.close、装配失败均不删除/迁移 Home、改权限或清空认证/原生会话；复用宿主 Home 继续工作 | 独占临时目录及文件/权限快照、真实续聊 |
| A10 | owned deadline 与 borrowed release 失败分别报告 incomplete；一个 disposer 失败仍尝试其他资源；重复关闭不重复释放 | 有界清理/失败注入专项 |
| A11 | 两个 Runtime 共享连接的 RPC ID、thread/turn、通知和审批不串线；无两个独立 reader 争抢同一 stdio | 共享关联器 fixture、真实交错调用 |
| A12 | doctor/status 只读且不启动 Engine；owned 与 borrowed 的来源明确，不把引用 PID 声称为受管对象 | 诊断回归、实际 CLI 输出 |
| A13 | CLI 常驻/Playboard、Kernel RPC、低层 direct Core 和包外 SDK 都覆盖；无新增 worker/外部 Node 代启，未改其他 Adapter 执行模型 | 类型/包外消费、PID/socket 与源码审查 |
| A14 | docs 的每个模块均列持有对象与生命周期责任；CODEX_HOME/Runtime Home 不混用；所有示例使用真实公共导出 | 文档审查、既有 docs 检查 |
| A15 | 相对目标 main 的 workflow、默认 selector、scripts、package Gate 范围未扩大；记录实际检查列表 | git diff、现有检查清单 |
| A16 | 非 Codex 黑盒 Adapter 使用任意参数的构造函数，以及工厂/闭包直接组装对象；可传具体 client、其他对象、多个参数和函数，构造结果均可按公共执行合同注册；不要求 Codex 类型、统一 options、manifest 序列化、PID/Home/stdio 或通用 Engine 注册；关闭一个 Adapter 不误关共享依赖 | 手动 fixture、公共类型及包外消费；不据此宣称真实 Electron 实测 |

## 检查执行方式

规划阶段仅执行知识/文档检查。实施阶段按下面命令运行；各阶段证据分开，不复用旧通过数。

实施执行已有 `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm test`、`pnpm docs:check` 及包外发行消费。新增专项放 `test/manual/`，显式运行 `node --test test/manual/339-*.test.mjs`；脚本已创建，不加入现有默认 selector。沿用或迁移 #313 手动专项并注明版本，不复用旧通过数量冒充新证据。

真实 Codex 记录源码/dirty、版本、平台、命令、PID/incarnation、调用结果和清理事实。macOS、Linux、Windows、Electron 原生集成分别报告；外部 Electron 未验不阻止库内规划或接口实现，但不能宣称 Electron 实测通过。用户已授权审查、autofix、commit/push 与 PR 到 main；不合并或发布。
