---
type: Journal
title: 删除全局watchdog关闭开关
description: enforcement及兼容分支整组删除，保留有限预算、模型空闲策略和静默通知。
tags: [runtime, watchdog, cleanup, validation]
---

用户确认运行更久由调用方提交更大的有限预算表达，明确删除limits.enforcement及旧兼容分支。Schema、生成类型、SDK映射、watchdog默认/全局退出、旧新冲突检查及正向旧fixture已删除。旧enforce/observe字段均拒绝；model_idle_policy和其他预算/取消/清理及60秒静默通知保持。

全量1403通过、61既有跳过，双包验收与临时源码/构建/归档lint通过。协议和文档两个专项子Agent复核，无未关闭发现。记录见[任务](../../tasks/remove-limits-enforcement/brief.md)、[验证](../../tasks/remove-limits-enforcement/validation.md)。现行规则已回写，历史范围不冒充当前合同。未扩大CI、未提交或发布。
