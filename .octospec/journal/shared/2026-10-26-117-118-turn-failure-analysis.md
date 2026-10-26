---
type: Journal
title: Issue 117/118 最新主线分析与规划
description: 在独立 worktree 核对执行前错误反馈与未知误报，记录合理性、建议和本轮证据边界。
tags: [channel, delivery, session, invocation, testing]
---

# 规划阶段记录

2026-10-26 拉取 origin/main，从 `8af836068780ebb76581225254ad7bef18cc8170` 创建 `codex/117-118-turn-failure-analysis`，路径为 `octo-runtime-117-118-analysis`。读取两个 issue 正文、全部评论和仓内相关规则，按 octospec-workflow 的规划阶段完成[简报](../../tasks/117-118-turn-failure/brief.md)与[分析](../../tasks/117-118-turn-failure/analysis.md)。

目标合理：#117 补齐未提交执行的失败反馈，#118 区分未提交与真实未知。当前源码仍有对应分支，WeCom 也应纳入后续同类修复。建议展示初始化异常先终止本轮，不因展示故障绕过交互；保留 ACK 不明及流丢失的 unknown 和禁止自动重跑语义。多次尝试分别记录，不能把后一次未提交扩大成整轮未执行。

用户随后要求按可执行性评估补齐三处缺口，已新增[实施合同](../../tasks/117-118-turn-failure/implementation-plan.md)：普通运行日志安全字段的精确映射及 worker 文件验收；保留 service-status 对任务诊断的过滤；Kernel 私有本地错误标记与公开只读判断；not_submitted 和内部收尾分类；执行前展示失败必须结束、执行中展示失败保守取消并继续观察原流。按 M1–M5、V01–V10 分解实施与验收。规划准备度自评由 92 调整到 98，不能视为实现或测试完成。

## 检查与边界

用户随后确认必须复用统一错误投影和既有结构化日志链路，并新增统一公共码。简报规划 `OH-RUN-2010` / `2011` / `2012`，分别覆盖执行前会话读取、展示初始化及明确接纳拒绝；三出口共用 FailureEnvelope 与 diagnosticId。当前基线全仓检索未发现编号占用，实施前仍须核对目标 main。新增要求同步写入 Channel 规则和验收；没有修改产品错误目录或日志实现。

- 本轮只有规划文档，没有修改产品代码、仓内测试或执行策略，未创建提交、推送或 PR。
- 系统 python3 缺少 PyYAML，改用仓库已有推荐命令 `uv run --with pyyaml python .octospec/scripts/lint.py`。
- 改动前的 OKF lint 已有四项缺少 frontmatter：systemd-directive-paths 的 brief.md、review.md、2026-10-22 journal，以及 2026-10-24-124-sass-build-fix journal。后续只核对本次是否增加错误，不顺带修改历史材料。
- 改动后 OKF lint 与基线四项错误一致，没有新增格式或文件链接错误；diff 空白检查通过。收尾再次查询远端 main，仍为同一 SHA。
- 当前结论来自源码分析；没有在新基线上运行 issue 的复现脚本、产品构建或产品测试。未进行真实 IM 收发、Provider 调用或跨平台验收，不引用历史测试数量作为本轮通过证据。

## 后续实施与审查

用户随后授权开始实施、verified-review 审查修复、创建带 Closes #117/#118 的 PR 并普通合并 main，明确禁止 Auto Merge。已实现共享三码、Kernel 本地可信证据、双渠道独立反馈、Gateway not_submitted attempt、兼容 occurrence 字段和普通日志安全字段。展示故障保留原流消费，真实未知不得重新执行。

审查运行复现并修复了流失败残留重试入口、finish 超时未保留关闭失败、drain 期间展示更新错误被吞三项问题。具体前后结果、命令及本地/线上证据边界见[验证记录](../../tasks/117-118-turn-failure/validation.md)。Gateway 真实 IM 缺 QA 账号文件路径；WeCom 真实验收按用户明确指示跳过，不能将本地投影测试写成真实卡片送达。

后续处理 Jerry-Xin/yujiawei 对 `7e03551` 的审查，真实 IPC 复现展示取消导致观察 signal 中止、已确认终态被丢弃。展示故障改用仅取消执行及后续重试的入口，保留原观察；补齐四个真实 IPC 对照和暂态重试回归，显式恢复 occurrence mock。全量 Node 1807 通过/40 跳过、WebUI 35 通过，类型/lint/命名/格式/文档检查通过；用户授权推送后新增英文评论请求两位重新审查，详细证据见验证记录的后续审查章节。
