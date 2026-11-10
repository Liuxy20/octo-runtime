---
type: Review
title: PR352 静默通知竞态复核
description: 记录独立时序与文档专项审查以及原始问题的关闭依据。
tags: [review, silence, race, documentation]
---

# 原始发现与修复

[yujiawei 的 P1 review](https://github.com/Mininglamp-OSS/octo-runtime/pull/352#pullrequestreview-5844889894)成立。独立时序子 Agent 使用真实 AgentExecutor、真实 ModelOutputSilence 和 deferred Provider next 复现：基线 ab9762dc 在 timer wake 后、Core take 前收到新文本，pending 被清空，通知数量为 0；同一脚本在修复构建上交付恰好 1 条 notice，再交付新文本，4 次 next，清理 complete。

修复将区间 reset 与已生成事实的交付分离，单槽占用时禁止覆盖；take 后按最近真实输出时间重新计时。Core 无论 notice 还是 Provider 先赢 race，均先取待发通知；yield 后再次检查取消。终态、取消、源结束/异常仍清理 pending。没有新增公共协议或无界队列。

# 独立专项结果

- 时序子 Agent：临时复现前失败、后通过；独立单槽/工具等待两项通过。检查唯一 pendingNext、源结果保留、通知顺序及终态优先级，无未关闭发现。
- 文档子 Agent：检查规则、原任务、新任务和中英文文档；区分未达阈值区间与已生成通知，确认历史验证记录仍按原基线保留。临时 JSON/元数据 lint 及负向种子检查通过，无未关闭发现。
- 主 Agent：检查生产 diff 与新增手动回归。旧背压测试 mock 原先无条件返回 notice，现改为仅在生成后消费一次，匹配真实单槽行为。检查和实际结果见[验证记录](validation.md)。

这是本地专项审查结论；不替代 GitHub reviewer 重新审批。
