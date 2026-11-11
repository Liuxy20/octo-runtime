---
type: Task
title: PR352 静默通知交付竞态修复
description: 回应yujiawei的review，分离已生成静默事实的交付与下一静默区间计时。
tags: [review, runtime, silence, race]
---

# 已确认问题

基线ab9762dc791853c59c18349a6141888606c7ac64。计时器达到60秒并唤醒notice waiter后，仍在途的Provider next先进入readNext，新的有效文本调用reset清空pending；Core随后take得到undefined，已生成通知丢失。实际竞态位于wake和take之间，不是已经yield的通知被撤回。用户要求处理PR352的review，沿用既有修复、专项子Agent复核、commit/push和评论交付流程，不合并PR。

# 修复合同

区分未达阈值的计时区间和已经达到阈值的通知事实。新输出重计满60秒，工具/同步交互/排队暂停后续计时，但不清除已生成的通知。每轮只保留一个pending槽，待交付时不能被新区间覆盖；take消费后按最新since继续计时，不累积事件队列。

Core在消费同时就绪的普通Provider结果之前优先交付已有notice，不并发next、不丢弃源结果、不重复准备消息。取消、终态、源结束/异常及资源清理仍清除pending并停止计时，保持既有优先级。

# 验证

先用实际Core+真实observer、可控时钟和deferred next复现，再跑同样用例验证修复；追加单槽不可覆盖、下一周期重置、Provider赢race仍通知先交付、取消/终态清理用例。新增专项只在test/manual和临时脚本，不扩CI、不新增协议字段。同步更正此前“恢复后清除过期通知”的歧义，记录构建、全量、双包及独立专项结果。

# 后续 CI 修复范围

4bb30c53 的 Windows Node 24/26 均在现有文件权限专项失败：ACL 查询 PowerShell 运行约 10 秒后被 execFile 超时终止，输出为空。失败不在静默通知测试；Linux/macOS 构建测试均成功。仅调整测试辅助程序的有限预算：ACL 读取与负向 fixture 写 ACL 从 10 秒改为 30 秒，嵌套 Node 外层从 15 秒改为 45 秒。保留权限正负断言、模块路径隔离及错误传播，不新增重试或跳过，不修改 workflow/矩阵/默认测试范围。独立子 Agent 核对调用链及嵌套预算，真实 Windows 结果以新提交的现有 CI 为准。
