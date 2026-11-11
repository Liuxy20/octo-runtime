---
type: Task
title: 删除全局 watchdog enforcement 开关
description: 删除全局退出计时开关及旧兼容分支，调用方通过有限预算表达执行时长。
tags: [runtime, protocol, watchdog, cleanup]
---

# 目标与合同

用户明确授权删除 limits.enforcement 及兼容分支。Schema、生成类型、SDK snake/camel 映射、默认值、watchdog全局提前退出、旧新策略冲突判断、正向示例及专属兼容测试全部删除。调用方通过各项有限预算表达允许时长，Runtime始终执行相应预算。

model_idle_policy/modelIdlePolicy保留现有enforce/observe语义，只控制模型空闲终止；首帧、工具、整轮预算及其上下界保持。model_output_idle独立通知及恢复输出后重新计满60秒保持。取消与清理合同保持，不新增关闭计时别名、Infinity/0特殊值或迁移转换。

旧enforcement字段在RuntimeLimits/ContextLimitsPayload Schema和Adapter语义校验中拒绝。通用AgentEnv信封仍接受opaque payload，不把业务语义塞回公共信封校验。

# 实现与验证

复用当前工作树，基线7892ebdf2ed9b1fa859bd51f15da6d7f03c247e2。现有规则和双语文档更新为当前合同，历史阶段记录保留并追加后续范围说明。新增专项只用临时lint或test/manual，不扩大CI，不提交/推送/发布。

运行类型/构建、全量回归、既有静默专项、文档和知识lint、双包校验。临时删除lint扫描源码/构建/归档和Schema，验证旧值拒绝与保留预算，注入反例证明检查器有效。沿用用户要求的专项子Agent复核。
