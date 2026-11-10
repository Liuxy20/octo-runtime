---
type: Review
title: 执行信封补删结果与范围外事项
description: 记录旧准备回执、投影、设备寻址与全局 watchdog 开关的后续删除。
tags: [protocol, architecture, review, followup]
---

# 本次已经补删

PublicObjectMaterial 与 RunContextProjection.object_materials 的 task/discussion/mention/history 等业务定义属于 #349 删除闭包，已在双轴 review 中补删。用户随后明确要求删除整个 ContextPreparationReceipt 和 RunContextProjection；现已整组删除 Schema、生成类型、导出及旧专属测试，不再作为候选保留。

runtime selection 按用户后续确认一并删除：设备寻址、授权候选、离线等待和故障转移归调用方，client 向已选定 Runtime invoke。

# 后续授权删除全局开关

用户进一步明确删除 limits.enforcement 及兼容分支，调用方使用有限预算表达执行时长；该项不再属于待讨论候选。model_idle_policy及其他预算保持。具体合同与验收见[删除任务](../remove-limits-enforcement/brief.md)。

审计范围为当前 Runtime 工作树及已固定的 Gateway origin/main@beb804933ff34e75225645a34b1a7fd038c52ad8。Gateway 该版本的 packages 中未发现 ContextPreparationReceipt、RunContextProjection、PublicObjectMaterial 类型名称；这不证明所有外部消费者都不存在。

ContextConfiguration、mergeContext、resolveContextConfiguration 是已明确保留的调用方显式组合工具；本次只删业务 references 专用合并，不把它们误报为 Core 的隐式拼接。

# 已知验证和交付边界

Grok 原生 mode setter 已接受，模型执行仍受翻墙网络环境限制；Windows/Electron 实机和其他 Provider 真实验收未补跑。Gateway 业务类型/材料/历史迁移仍需在其仓库实施。实现验证阶段未提交或建立 PR；用户于2026-11-10追加授权提交代码并评论关联issue，交付状态以Git记录和issue评论为准。本清单不扩大CI或变更仓外合同。
