---
type: Journal
title: Issue 309：独立客户端与双包发行本地交付
description: 记录先规划后实施的发布约束、双包自包含模型、本地验证及两轴审查闭环。
tags: [architecture, packaging, release, testing, review]
---

# Issue 309 本地实施

从最新 main `de3ff37a` 建立独立 worktree 后，按用户要求先补齐背景、目标、收益、风险与 95/100 可执行性自评。用户随后确认“一份源码、两种自包含发行物”：runtime 使用自己内置的 client/protocol，client 同 tag 独立发布且仅内置 protocol；protocol 不成为第三个 npm 包。跨发行物不承诺类/函数/WeakSet 身份，保持结构类型及协议行为兼容。

授权实施后完成唯一 client 源码迁移、Kernel 兼容转发、纯路径诊断及 metadata 类型边界、IPC 版本拒绝、双包产物与现有发布恢复步骤。runtime 单 tgz 离线及 npm/pnpm 全局安装保留。workflow/job/矩阵/触发/needs/必需状态、step 数及根默认脚本均未扩大；新增专项仅显式手动运行。

本地完整构建/类型、lint/命名/格式、docs、native 生成检查通过；WebUI 35 项、Node 2334 通过/66 原有跳过、client 手动 6 项、发布恢复手动 19 项均通过。最终归档空缓存包外安装、严格类型/身份边界、原始 `de3ff37a` Kernel 互操作、runtime 原单包验收与 global Extra npm/pnpm 场景通过。global verifier 为适配 npm12 输出复用现有 parser，没有新增验收范围。

用户指定 code-review 后执行独立 Standards/Spec 两轴。Standards 发现测试凭据占位、attach 注释和 incomplete 清理三项，修复复核后剩余 0；Spec 0 项实现问题。

详细归档完整性、体积、命令、失败处置和未验环境见[验证](../../tasks/309-runtime-client/validation.md)及[Review](../../tasks/309-runtime-client/review.md)。完成审查后用户追加授权英文提交、推送并向 main 创建 PR；交付前 fetch 确认 main 未变化。合并、打 tag 和正式发布未授权；Node26、Linux/Windows 真机、Electron、真实 Provider 与官方 npm 权限/provenance 未验。

## PR #316 冲突解决

用户随后授权解决冲突、英文提交并推送。将最新 main `11dbab88` 合入功能分支，协调 #314 统一启动诊断与纯路径抽取：纯诊断及 catalog 在 client 保存唯一实现，Kernel 保留显式转发，服务生命周期和 IO 继续归完整 Runtime。完整构建、类型、lint、格式、文档、原测试套件、双包手动 25 项和单包离线验收通过；启动诊断手动 30 项通过、1 项 Windows 专属跳过，macOS 长临时目录场景通过仅本次指定 `TMPDIR=/tmp` 重验。相对最新 main 的 13 个 workflow 结构和默认 scripts 复核未扩围；实际结果及环境边界见验证记录末节。

## 远端 review 后续

yujiawei 指出 dry-run 把未验证候选当作完整版本输出提升 actions。已复现并按用户授权修复为显式候选/目标验证状态、未验证目标仅给 conditionalActions 和警告；正式入口拒绝 candidate。该模拟逻辑在 main 原已存在，实际发布始终保留远端完整性校验，故接受修复并在英文回复中建议按 P2 评估。只补本地手动专项，未新增 CI 或默认测试；具体命令及结果见验证记录后续小节。

## 再次同步 main：#317

按用户追加授权，将最新 main `b5396834` 合入 PR #316 原分支。保留 #309 的唯一 client 和已提交的 dry-run 语义修复；#317 的共享 status 校验移接到 client，接纳旧 status 与合法服务快照，保留客户端版本拒绝和受控错误。合并两边知识索引，UTF-8 夹具采用新共享白名单允许的合法字段。补充的 status 场景只在原手动文件执行，未扩 CI。实际结果及未验边界见验证记录的再次同步小节。
