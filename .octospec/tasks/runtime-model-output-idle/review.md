---
type: Review
title: 模型输出静默专项审查与修复复核
description: 记录计时、协议闭包及文档三组并行审查的可复现发现、修复和验证边界。
tags: [review, protocol, silence, documentation]
---

# 范围与基线

2026-11-10，基线 `7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2`，dirty worktree，Darwin arm64、Node 24.22.2。无新增提交，审查使用 `git diff HEAD --` 加未跟踪文件全文。沿用已明确任务，不另选历史提交。此前 #348–351 两轴审查见[旧任务 review](../348-351-context-envelope/review.md)。本轮按用户要求启动三个专项子 Agent：计时/竞态 Spec、协议与删除闭包、文档 Standards；不是对整个仓库所有历史代码逐行重新审查。

审查依据为本任务 brief、用户追加的输出重置要求、AGENTS、architecture/engineering/output-protocol/protocol-schema/protocol-design 规则。采用 code-review 的两轴区分、verified-review 的复现证据规则、technical-writing-zh 的歧义审查。生成文件只检查合同与源码一致性，不逐行评价生成器风格；旧历史记录区分当时事实与现行合同，第三方依赖不在范围。

# Spec：计时与异步路径

原 2 项 P2，均由子 Agent 在修复前复现，修复后独立复核关闭：

1. **消息数量截断**：原 `retained = this.#messages.has(key) || this.#messages.size < 256` 使第 257 个消息的 snapshot 永远不再刷新计时。t=0 的 256 条消息后，t=30s 的新消息仍在 t=60s 收到通知，只过 30s 就误报。现去掉观察器的第二套消息缓存，在 Core 原 MessageState 中只增加长度和 role，按相同消息准备结果判断新文本。
2. **匿名消息与公开性重复推断**：原 `key = p.messageId ?? anonymous:channel` 把独立匿名 create 和不同 step 合并，较短的新消息不刷新。该重复状态还会继承 public exposure，而 Core 准备后的 analysis exposure 已是 unknown。现源端 readNext 调用原 prepareMessage，使用实际规范化的身份及公开性；缓存一次准备结果供后续输出，不重复准备或并发 next。

主线程此前已发现并修复空状态补丁/回退快照降低长度的问题，现保留最大已见长度。重复文本不作为进展；新 delta 或增长快照重计满 60 秒。这个发现不冒充子 Agent 首次发现。

修复前 `/tmp/silence-timing-repro.mjs` 的退出 0 表示成功复现缺陷；修复后 `/tmp/silence-timing-fixed.test.mjs` 的 2 项通过表示实际 Kernel 消息事实与假时钟验证通过：新输出后 30s、59999ms 不发，60000ms 才发。既有定向 4 项也通过。另检查 preparedNext 消费后清空、notice 保留原 pendingNext、全局关闭补丁、终态/取消/异常释放；未发现新缺陷。

## 追加背压专项：P1 已修复

最后一轮主动检查发现同类竞态：消费者停在 notice 时，仍在途的 Provider next 已返回真实终态，但 watchdog 直到消费者恢复才接收该事实。实际 Core 首帧预算100ms、整轮10s，注入一次5ms通知后停读200ms，源端已 completed，却得到 ADAPTER_FIRST_FRAME_TIMEOUT。无通知对照 completed。该问题会把已完成执行报为失败，不能只修计时展示。

现 watchdog 在源 next 就绪时处理合法 canonical 事实；未先取消的终态立即登记，晚到 cancel 返回false。源 next拒绝、无终态结束和协议校验失败同样停止旧预算，分别保留真实错误或HOST_ENDED_WITHOUT_TERMINAL。没有伪造成功终态，也不把消费者背压计入Provider清理宽限。分开 source.next 与后续校验的catch：只有源 next本身拒绝才触发既有nextFailed清理未确认合同；校验失败不假报资源清理失败。

原计时Agent独立复验8场景：terminal、tool、合法同步elicitation、晚到cancel、无notice对照、源异常、缺终态done、非法事件。全部符合预期，无首帧误分类。源异常保留SOURCE_FAILURE_SENTINEL且cleanup incomplete；非法载荷清理complete。脚本为 `/tmp/silence-backpressure-repro.mjs`，日志 `/tmp/silence-backpressure-*-final.log`。这是实际Core加提前通知注入，不是假称等待过60秒。正式手动套件增加对应四条背压回归。

**本轴累计 1 项 P1、2 项 P2，全部关闭；未关闭 0。** 实际墙钟验证见 validation；不据假时钟或提前通知注入宣称真实Provider已测。

# Standards：文档与代码质量

文档专项 P2 已复现并独立复核关闭：原文档检查器 `validateWire(value)` 对所有 JSON-RPC 示例使用 Request Schema，错误要求 notification 顶层 id。示例本身正确。现仅为已有 agent_run.event 选择已有 EventNotification Schema，保留请求校验；未增加 RPC、native 类型或 CI 范围。

两项 P3 文档歧义已修：双语页明确首次从 Core 开始 Adapter 调用计时；中文页把 Gateway “当前只消费”改为迁移要求，明确 issue #34 尚未实施。noticeId 是内容标识，不是 JSON-RPC 请求 id。

协议质量子 Agent检查新增 code 的 Schema、生成合同、三个实际协议入口、客户端接收和 Kernel 包装，及已删除定义的源码/构建/归档闭包，未发现 medium 及以上新增问题。计时重复消息状态已按上节删除，没有再建泛化 registry 或额外公共协议。中文核心注释说明源端计时、消息准备所有权及 pendingNext 保留原因。

**本轴未关闭发现 0。** 文档专项曾给 98/100 的人工可执行性自评，余 2 分当时用于待完成的计时对照；现行为复核已完成，仍不把分数当成自动测得的质量指标。

# 复核与限制

临时 lint 包含真实正例及内存注入反例，详情和命令见[验证](validation.md)。首轮旧 tgz 与新 Schema 不一致确实失败，重新打包后由协议子 Agent复跑至 0 项；不沿用旧归档结果。既有全量回归、打包校验与专项均本地执行，不是远端 CI。

未进行真实模型、Gateway、Windows/Electron 联调或长时间压力测试；不能承诺所有网络设备保持连接。未提交、推送、发布。Standards 与 Spec 分别关闭发现，不以一轴通过替代另一轴。

# 最终汇总

Spec累计1项P1、2项P2已修复；Standards文档校验1项P2及两项P3歧义已修复，均由对应子Agent复核。最终15项静默专项（含两段真实60秒）、1404项默认测试通过，61项既有跳过；双包与临时lint通过。未关闭发现0不代表未验的真实Provider/Gateway/Windows已通过。
