---
type: Assessment
title: Issue 313：方案可执行性评估
description: 按已确认设计和证据评价实施准备度，并公开剩余差距及阻塞条件。
tags: [architecture, lifecycle, testing, risk]
---

# 评分：96/100

这是启动实施前的规划自评，衡量责任、代码路径、步骤与验收的可执行性，不是成功概率、实现质量分、独立评审结论或测试通过率。现已实施，实际证据见 [验证](validation.md)；不能凭此分数关闭 issue。

| 维度 | 满分 | 得分 | 依据与扣分 |
| --- | --- | --- | --- |
| 问题和范围 | 20 | 20 | 最新 main 源码验证仍逐轮 spawn/close；#294/#312 已合入；#307 澄清作为明确回归合同；未重开已删除 worker |
| 所有权和接口 | 20 | 20 | Core 每注册 scope，Codex 管 Provider 服务；Kernel/direct 复用；owned/borrowed、初始化、Stop、shutdown 与服务遗留结果均有确定路径 |
| 配置、协议与并发 | 20 | 18 | 兼容键覆盖 argv/env/MCP/修订；找到随机 header 映射和 nullable elicitation 两处具体陷阱；真实多 thread/resume/elicitation 仍需 M0 证明，扣 2 |
| 恢复与诚实结果 | 20 | 19 | 明确单飞、代次、预算、停止恢复、无重放、#307 成功/cleanup 分离；跨 Core/Adapter 的最终最小信号需要实现并验证，扣 1 |
| 步骤、验收与交付 | 20 | 19 | M0-M6、21 组断言、手动命令、包外/IM/原生平台及 CI 边界完整；doctor 常驻 PID 视图由同源快照支撑；跨平台真实 kill/清理尚未验证，扣 1 |
| 合计 | 100 | **96** | 达到用户的规划分数要求；历史评分不替代后续实施验收 |

## 剩余 4 分如何关闭

| Gap | 分值 | 关闭条件 | 失败后的动作 |
| --- | --- | --- | --- |
| G1：指定版本多 thread、复用 resume 和配置隔离 | 1.5 | M0 真实 PID/连接/initialize 及交错通知、定向取消证据；同 thread 冲突和配置切换可重复 | 阻止 M2 交付，重新选并发合同并下调评分；不能悄悄加进程/worker |
| G2：nullable elicitation 的精确因果归属 | 0.5 | 正常真实 MCP 往返通过；关联不足有可诊断拒绝，且不误答新轮 | 正常场景无法支持时 A08 不通过，补路由设计，不能仅测有 turnId 的 fake |
| G3：Core 执行结果与轮次清理分离 | 1 | A15/A19 在完整 Core/Kernel 链路证实成功不被 finally 改失败，真实错误/取消不会伪成功，cleanup 仍可 incomplete | 阻止 M4 完成，优先解决共享终态合同，禁止只修改 Adapter 测试 |
| G4：OS 和真实服务故障清理 | 1 | macOS/Linux/Windows 的 idle/active kill、EOF-live-child、shutdown-during-recovery 分别有原生证据与限制 | 缺环境写 blocked；已观察失败保留，不以父进程退出或复用成功代替清理 |

## 关键设计取舍

采用 owned stdio，不增加 WS/unix attach 或全局 daemon 管理。stdio 支持持续连接，进程按服务而非 turn 关闭；换传输不是本问题的修复依据。

完整 env、cwd、MCP 和容量参数保守分池，优先保留现有输入隔离。代价是相同账号但不同逐轮身份/目录可能使用不同服务，最多 8 种配置。此限制明确拒绝，不通过自动淘汰健康服务掩盖；后续只有经原生合同证明后才能减少键维度。

首版不自动检测磁盘配置/认证/skills 变化。宿主传配置修订或重建 owner，避免在 Adapter 扫描认证文件；这是一项公开接入限制，不能包装成跨账号安全隔离。

多 thread 并发和隔离验证是发布阻塞项，不因规划评分高而可省略。若 M0 失败导致关键设计重选，96 分立即失效，需重评。

2026-11-05 追加 doctor 常驻进程视图：已定位现有 doctor 汇总入口和 KernelStatus Schema，选择扩展既有 status 的可选安全快照，无新 wire 方法或自动服务探测；A21 明确不展示 turn/临时工具。评分维持 96，G4 同时覆盖原生进程身份和观测边界，未因新增规划内容提高分数。

## 关联问题的状态

- #312 已经合入，不再将其未合入或 Codex 公共 export 缺失作为本任务阻塞。
- #307 与逐轮进程模型的因果联系尚未证实；其已澄清成功/cleanup 合同必须保留。
- #83 的 Windows/global daemon 行为需按版本另证，本次不操作无关 daemon。
- #294 已删除的执行 worker 不因新增 Provider supervisor 恢复；两者所有权和职责不同。
