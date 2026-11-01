---
type: Review
title: Issue 289 两轴审查及修复复核
description: 记录 code-review 的规范与需求独立审查、三项发现及闭环证据。
tags: [adapter, interaction, review, testing]
---

# 审查范围

使用用户指定的 code-review 技能，两个独立审查 Agent 并行执行 Standards 与 Spec。固定点 `148d737d3ee14f0453ae5018c563b08d6b21ec5b`；初审提交 `129d4cc8`，修复提交 `5783727f`。命令为 `git diff 148d737d...HEAD`，复核差异为 `git diff 129d4cc8..5783727f`。

需求依据是 [#289](https://github.com/Mininglamp-OSS/octo-runtime/issues/289)、[brief](brief.md) 与 [plan](plan.md)。规范来源为 AGENTS、CONTRIBUTING、context.yaml 中的匹配规则，以及技能的代码异味基线。仓库没有 `docs/agents/issue-tracker.md`，已向用户说明可用 `/setup-matt-pocock-skills` 配置；本次直接使用明确的 GitHub issue，不因配置缺失跳过需求审查。

## Standards

初审 1 项 P3：验证记录写「没有修改仓库规则正文」，与本次 output-protocol.md 合同补充不符。已改为区分同步脚本行为与本次实施修改。审查者复核关闭，代码规范和代码异味未发现问题。

当前未关闭：0；新增：0。该轴为静态检查，未重复执行作者测试。

## Spec

初审 2 项：

- P1：容量拒绝使用 8 条控制预留；265 条同步人工请求可使第 9 条拒绝在正常 Writable 上触发整轮容量失败。违反普通突发应排队排空、人工额度满不直接终止调用的需求。容量拒绝改走普通有界 FIFO，并确保 `control:false` 不被错误对象的默认分类覆盖。两种输出模式与 ask/assisted 共四组 512 请求验证：后 256 条拒绝排空，前 256 条全部可响应。
- P2：写入失败与进程清理失败同时出现时，AggregateError 顶层缺少执行首因 code，native Core 无法附加准确 failure。聚合错误现保留本地首因 code，同时以 errors/cause 保存清理异常；公开 Kernel 两模式均覆盖该复合故障及并行成功调用。

审查者独立复跑相关 6 项用例，6/6 PASS；两项均关闭，无新增问题。完整专项和相关回归见 [validation](validation.md)。

两轴结论分别记录：Standards 初审 1 项、最高 P3，剩余 0；Spec 初审 2 项、最高 P1，剩余 0。本报告不等同于 GitHub 人工批准或合并授权。

## 最新主线集成复核

主线 `dc14c094` 合入 #280 后，合并提交 `10336bed` 保留旁路问题的 ACK/终态语义，并将其额度独立于审批。Standards 复核新增问题 0。Spec 复核发现 1 项 P2：读取 async 消息的结构化校验失败被通用进程错误处理包装成传输失败。

修复为帧处理显式标记 protocol 来源，保留原结构化错误码；真实流异常仍按传输失败处理。新增 Adapter 集成用例覆盖 INVALID_ASYNC_QUESTIONS、INVALID_ASYNC_QUESTION_ID、ASYNC_QUESTION_CONFLICT。作者 174/174 定向回归通过；Spec 审查者独立复跑相关 13/13 通过，确认关闭且无新增问题。

最终：Standards 共发现 1 项 P3，未关闭 0；Spec 共发现 3 项（最高 P1），未关闭 0。远端 CI 在最终修正提交上重新执行，状态见 PR。
