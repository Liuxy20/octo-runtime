---
type: Task
title: "Task: Gateway 展示有界保留与终态释放"
description: "修复单轮展示累计超限导致取消，并释放结束后的投影引用。"
tags: [channel, presentation, lifecycle, storage]
timestamp: 2026-10-29T10:10:42Z
slug: 246-gateway-projection-window
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/246"
---

# Task: 246-gateway-projection-window

## Goal

每轮只保留最近五条展示明细及必要在途/步骤元数据；累计条数与累计公开文本不再取消执行。卡片和最终投递收尾后释放投影与无用回调引用。

## Background

初始复现基线 main@ba2a7063，后续冲突整合基线 main@01d0ca5d。Gateway 的投影 Map 全轮累计，超过 512 条或 256 KiB 抛异常并导致取消。当前卡片只展示近期内容。实施和构建在独立 worktree 完成，不修改日常 Home、配置或运行产物。

## Load-bearing list

- channel：身份、公开 reasoning 分类、累计次数和步骤关联保持正确。
- lifecycle：先消费真实终态并完成卡片及最终投递，再释放本轮数据；失败、取消、未知和关闭保持真实结果。
- storage：五条窗口同步释放文本；在途工具保留有限状态，不存完整输出；不新增持久化或无界历史 ID 集合。

## 意图与责任归属

业务目标是长任务可靠进度与稳定内存，决定权归 Channel Gateway。输入仍是既有 CanonicalEvent，公共 SDK/Kernel/Provider 合同及服务拓扑不变。Gateway 所有本轮投影、卡片调度与回调引用在其内部管理；不接管 Kernel、宿主或 Provider 的生命周期。

## Out of scope

- 不修改单次最终报文 256 KiB、不做 final 分段/附件。
- 不修改任务总时限、模型等待、工具执行、Provider 输出或其他 Extra。
- 不改变 CI workflow、job、矩阵、触发范围或默认专项开关；专项验证手动运行。

## Acceptance

- 超过 512 条及 256 KiB 累计进度可正常完成，最终回复完整。
- 展示明细最多五条，单条预览有界；累计计数/轮次稳定，迟到更新不恢复旧展示。
- 被淘汰的长工具在途状态与耗时仍正确，完整工具输出不驻留。
- 正常/失败/取消/异常/关闭收尾释放投影，卡片排空和 final 不被提前清空；必要按钮行为保留。
- Gateway 类型/静态检查及相关离线回归通过；真实 IM 和跨系统验收单独报告。

## Review 补充

当前提交确认三个边界缺陷：OpenCode reasoning 只结束步骤时仍保留消息元数据；ACP/OpenCode 的 terminal-only 工具被遗漏；已完成消息跨越退役缓存后可能复活或进入 final。修复与手动回归仍属于本任务，不扩大 CI；身份去重不得以无界整轮历史或静默丢失最终正文换取有界内存。

Jerry 补充的跨步骤、同时省略 stepId/channel 的迟到帧已确认会使私有 reasoning 进入 final。分类在接收边界采取保守处理：未知通道不默认 final，已结束步骤后的未知非 final/工具终态不能仅按当前步骤补造归属。OpenCode 原生 text 本身具有最终正文语义，在既有归一化函数显式补充 channel=final 以保留正常回复；不改变正文、Provider 执行或公共协议结构。不新增整轮身份历史、概率去重或容量中断阈值。
