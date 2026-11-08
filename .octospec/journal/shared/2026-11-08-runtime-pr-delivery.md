---
type: Journal
title: Runtime 拆仓与 agentEnv PR 交付
description: 用户追加授权提交与合并，记录范围、已有验证与仓库保护条件。
tags: [architecture, git, delivery]
---

用户授权 Runtime 提交 PR 并合并 main；只交付 Runtime worktree，独立 Gateway 另行维护。main 基线仍为 bf9ff6b599b0e325362698acd3cebd9ac1363467，没有上游差异需要重放。

交付包括 Issue 328 的 Extra/native/内置渠道移除，agentEnv 四参数 API 与 interrupt，双语文档和相应测试/发行闭包迁移。规划、实现、独立审查和本地实测见 [拆仓记录](../../tasks/328-remove-extra/validation.md)、[API 验收](../../tasks/agent-env-invocation/validation.md)及[审查](../../tasks/agent-env-invocation/review.md)。提交前 format、lint、命名和 octospec 检查通过；提交后的发行源 SHA、远端 CI 和合并事实以对应 PR 为准。

GitHub main 保护要求 CI Gate、至少一位非作者批准、对话解决；管理员亦受约束。仓库未启用自动合并。不会修改保护规则或伪造批准。真实 Provider/IM 本轮未执行，原生跨平台验收以实际远端结果为准；合并不等于 npm/tag 发布。
