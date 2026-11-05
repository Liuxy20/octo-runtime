---
type: Task
title: Issue 313：Codex app-server 服务级所有权与自动恢复
description: 在独立 worktree 实现可复用 Codex 服务、逐轮隔离、精确交互路由及有界恢复和关闭，记录本地验证及未验边界。
tags: [architecture, adapter, lifecycle, invocation, interaction, envs, mcp, testing]
---

# Issue 313 需求简报

状态：**已按用户授权实施并完成本地审查验证，进入 PR 交付；完整跨环境验收尚未完成**。来源：[Issue #313](https://github.com/Mininglamp-OSS/octo-runtime/issues/313) 及其最新评论。基线为本次成功 fetch 的 `origin/main@de3ff37a86ee3cb8f6ab66148ceca817f6ae5240`，已包含 #294 原生 Adapter 装配和 #312 direct/IPC Extra。独立分支从 `plan/issue-313-codex-service` 更名为符合仓库约定的 `feat/codex-service-lifecycle`。

用户随后明确“开始实施”，当前交付源码、手动专项、双语文档及分层验证记录；完成 code-review / verified-review 后追加授权提交、推送并创建目标为 main 的 PR，未授权合并或发布。原规划可执行性自评 **96/100**，是历史准备度自评，不表示实现质量或全部验收通过。实际结果见[验证](validation.md)和[验收矩阵](acceptance.md)。

## 背景

用户需要在长期运行的执行服务上提交多轮 Codex 任务、回答审批/问题，并在停止一轮后继续使用服务。规划基线中 Codex Adapter 的 `invoke()` 每次创建 app-server，正常完成也在 finally 中关闭进程。Kernel 或 Adapter 对象长期存在，不能证明 Provider 进程被复用。

基线客户端还同时持有进程、单轮 signal、事件队列、thread/turn、审批和 finalization timer。直接缓存该对象会把上一轮的取消、回复和终态状态带进下一轮。最先需要修改所有权的位置是 Codex Adapter；Core 已增加服务作用域的绑定和关闭合同，Kernel 不增加第二份 Codex supervisor。

## 场景与收益

| 场景 | 目标行为 | 可观察收益 |
| --- | --- | --- |
| 同配置首轮、续聊、同会话追问 | 复用健康 app-server，逐轮重新绑定 thread/turn | 多轮 PID、connectionId、incarnation 相同，initialize 总数为 1 |
| A、B 两个 Extra 和宿主共用 Core | 各自提交/停止/回复；关闭 A 后 B 与宿主仍可用 | 不以 A 的 signal、iterator 或 close 关闭共享进程 |
| app-server 空闲时被杀 | 原服务 owner 主动恢复，不等待下一条业务请求 | 无新 invoke 也能观测新 incarnation 和 ready |
| app-server 执行中被杀 | 原调用失败或结果未知；恢复供后续调用使用 | 不自动重放工具动作，不把恢复可用写成旧任务成功 |
| 不同凭据、Home、env、MCP 或版本 | 分配不同兼容配置的服务 | 不把另一调用方的身份或进程配置带入本轮 |
| #307 已完成答案但缺 turn/completed | 依已澄清合同保留成功答案，单独收尾 | 回答和产物不被清理中断改写为失败；同会话追问另验 |
| doctor 查看常驻进程 | 展示所选实例的 Host/Kernel、独立 Extra 及其受管 app-server 的 PID 与归属 | 直观看到常驻服务复用、重启换代和遗留资源；不列 turn、thread、临时工具或命令进程 |

减少重复进程启动和握手是可验证的机制收益；时延、内存、吞吐和 #307 因果关系尚未实测，不承诺百分比改善。常驻服务也会增加空闲资源和共享故障影响，需要配套有界容量及独立清理事实。

## 决定权与服务拓扑

| 检查项 | 本任务决定 |
| --- | --- |
| 宿主负责 | 选择/安装 Codex、认证、Home、配置与配置修订，创建和关闭 Core/Kernel；业务会话及投递策略 |
| Core 负责 | 为每次 Adapter 注册建立独立执行作用域，统一停止准入和关闭该作用域，汇总清理结果 |
| Codex Adapter 负责 | 在作用域内拥有服务池、stdio 连接、启动、初始化、逐轮路由、健康、恢复和 owned 进程清理 |
| Kernel 负责 | 原生持有 Core，沿现有 RPC 执行；close 进入同一 Core shutdown，不另建 Provider 管理器 |
| Extra 负责 | 本 Extra 的调用和业务资源；借用执行能力，不拥有 Codex 服务或 Core |
| direct | 宿主持有 AgentExecutor；Extra 借用该对象；宿主最终 shutdown；不创建 Kernel、Home、socket 或 worker |
| IPC | 业务/Extra → KernelClient → RPC → Kernel 内同一 Core → 已绑定 Codex 执行作用域 |
| 首版启动机制 | owned `codex app-server --listen stdio://`，首个兼容请求显式经过 ensureReady；建立后常驻，空闲故障主动恢复 |
| 外部服务附加 | 首版不支持；不连接、接管或终止全局 daemon，不借 #83 推定通用 attach 合同 |

## 关键合同

1. 服务的资源生命周期属于 Core 执行作用域；同一 Adapter 描述对象注册进两个 Core，必须得到两个独立作用域。无进程级单例。
2. 逐轮状态与服务状态拆开。正常完成、Stop、观察退出和单个 Extra 关闭不结束健康服务；只有 owner shutdown 关闭 owned 服务。
3. 共享前比较完整兼容配置。私有 MCP header 的随机环境变量名不能造成每轮新服务；凭据值不能出现在键日志、argv、文档或诊断中。
4. 恢复单飞、有界、带 incarnation；旧 RPC/回复失效。服务恢复不重放 turn/start、steer、interrupt 或交互决定。
5. 控制仍绑定原 invocation、thread、turn 和 incarnation。原生 requestId 保持 opaque；缺少足够关联信息时明确拒绝，不能猜当前轮。
6. 并发支持必须经指定 Codex 版本证明；单 thread 单 active turn。发布前必须实测多 thread 交错事件、审批及定向取消，不能以 fake 或 schema 代替。
7. 执行终态、轮次清理、服务清理和业务投递分别报告。#307 的成功 fallback 需同时修正 Core 终态闸门，不能只在 Adapter yield completed 后被 Core finally 改写回失败。
8. 本专项新增验证仅在 `test/manual/` 显式运行；不扩大既有 CI、默认选择器、发布/打包 gate 或必需状态。
9. 用户于 2026-11-05 确认 doctor 的 PID 树只展示常驻进程。诊断只读，由 owner 提供受管服务快照；不为查看而启动 Provider，不扫描其他实例的全局 Codex 进程。

## 风险

| 风险 | 处理与验收 |
| --- | --- |
| 共享服务泄露 env/凭据/MCP | 完整进程环境与解析后 MCP 进入私有兼容键；轮间换身份、换 header、Windows 大小写分别验 |
| 回复被重启后的同号 requestId 接收 | incarnation fencing、原 invocation 路由和退役路由撤销；构造 ID 重用负例 |
| 反复崩溃形成进程风暴 | 单飞和有限重试；旧进程退出未确认时禁止重叠替换 |
| Stop 或慢消费者连带其他轮次 | 定向 interrupt、逐轮有界队列、保留共享 writer；已污染 transport 才由 owner 恢复并报告全部受影响调用 |
| #307 修复伪造成功 | 资格检查、真实错误和用户取消优先；迟到事件不能改写已锁定结果；清理单独报告 |
| 常驻进程或 thread 无限增长 | 服务池、在途请求、交互及队列明确上限；终态退订原 thread，不 archive/delete 用户会话 |
| OS 清理保证被夸大 | 保留 Node.js/现有系统命令边界，Windows leader 退出后的后代不可观测限制单列 |

详细行为、阈值与修订点见[设计](design.md)，阶段顺序见[计划](plan.md)。

## 范围与验收

本次已实施 Codex Adapter/SDK、Core 服务作用域与最小本地终态合同、现有 Kernel status/清理汇总、doctor 常驻 PID、共享 Schema/生成类型、双语文档和手动专项。turn 状态仍留在 app-server.ts，新增 service.ts 持有进程；未为文件名拆分另建 turn.ts。

范围外：恢复已删除的执行 worker/launcher、Pod/global singleton、Provider 安装或认证管理、跨进程持久执行、业务数据库、配置文件/身份重置、自动业务重跑、全局 daemon attach、修改其他 Provider 的进程模型、扩大 CI。

验收结果绑定上述 baseline 加当前 dirty worktree。离线 fake、真实 Codex、实际 IM 和操作系统证据分别归档；缺环境写 blocked，未执行写 not run。macOS 的 direct/IPC 五轮真实调用、idle/active kill 和 MCP 往返通过，不据此关闭 Linux、Windows、实际 IM 或 Electron 的验收项。
