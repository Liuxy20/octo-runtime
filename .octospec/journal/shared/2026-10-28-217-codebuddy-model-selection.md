---
type: Journal
title: CodeBuddy 217 选模与切模交付记录
description: 原生 setter 确认、真实请求模型和 Gateway 错误送达的验证事实。
tags: [adapter, channel, testing]
---

# 实施与结论

2026-10-28，按用户要求从最新 main 建立独立 worktree，先写 [OctoSpec](../../tasks/217-codebuddy-model-selection/brief.md)，方案准备度 96/100 后实施。
CodeBuddy 2.177.1 的 session/new 忽略 model；真实探针先复现，再用 session/set_config_option 确认改变。
新进程 session/load 也会返回原生默认，旧 binding.model 不能证明本轮实际选择。

修复只在 CodeBuddy adapter：显式模型先按本次目录校验、设置及确认，再 prompt；未知或拒绝不静默执行旧模型。省略模型保留原生默认，原生失败继续沿 #216 的消息原文合同传播。
这些可复用结论已回写 [Adapter 规则](../../rules/adapter-metadata.md)。

# 验证事实

- 修复前新增反例 11 项中 10 项失败；修复后最终专项 55 项全部通过。
- 最终全量 Node 2105 项通过、56 跳过，WebUI 35 项通过；类型、静态、格式及知识库检查通过，见[验收](../../tasks/217-codebuddy-model-selection/validation.md)。
- 真实 Gateway → KernelClient.invoke → worker → CodeBuddy → canonical → IM 回读共 7 项断言完成。主 Agent 请求依次使用 hy3、hy4-preview、hy3、DeepSeek、DeepSeek；两次非法选择没有 prompt。
- hy3 正常完成；hy4-preview 的真实切换生效，但上游请求失败，错误已送达；DeepSeek 真实订阅到期也已按原文送达。没有声称这些拒绝模型可用。
- 保持同一个有效原生 session，拒绝后有效选择仍可继续。7 个 transport 关闭、Kernel 清理完整。
- [本地 verified-review](../../tasks/217-codebuddy-model-selection/review.md)未发现遗留 medium 及以上问题；Linux/Windows、其他 Provider 版本和卡片 UI 未在本机验证。

仅使用用户指定 QA 文件中的测试身份和既有测试群，不改好友关系、成员、认证或部署配置；测试消息留存用于核对。用户授权提交及英文 PR，不自动合并、部署或发布。

# PR 218：文档明确验收边界

按用户后续范围，只补文档声明：所有 adapter 的 fake 回归留在默认 CI，真实 Provider/IM 验收独立 non-gating，由变更作者执行并归档，原生行为或版本变化时重跑受影响路径，reviewer 核对证据和限制。
不修改生产实现、测试组织、脚本、package 命令或 CI 工作流。[通用指南](../../guides/provider-live-acceptance.md)列出现有 CodeBuddy 命令和证据要求；补充检查和草稿阶段误触发原生检查的结果见[验收补记](../../tasks/217-codebuddy-model-selection/validation.md#pr-218-评审补充独立非门禁验收)。
