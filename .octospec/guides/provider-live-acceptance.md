---
type: Guide
title: Provider 独立真实验收
description: 全部 adapter 的非门禁真实验收定位、执行责任、重跑条件和证据要求。
tags: [adapter, testing, integration]
---

# 验收定位与责任

适用于全部 `octo-runtime-adapter-*`，规则正文见[开发与验证约定](../rules/engineering.md#provider-离线门禁与独立真实验收)。
默认 CI 使用 fake Provider；真实 CLI、模型、IM 及远端 Gateway 验收为独立 **non-gating live acceptance**，不是必需 GitHub status。
离线通过只证明被测合同回归通过，真实结果只覆盖记录的版本、账号、模型和当次场景。本指南不改动测试入口、断言或 CI 工作流。

变更作者负责选择受影响场景、执行并将脱敏证据归档到任务 validation 和 PR 的独立 `Non-gating live acceptance` 段落；reviewer 核对范围和限制。
修改原生映射/确认、模型/会话/恢复、权限/工具/MCP、多模态、终态/清理或升级原生版本时，应重跑受影响场景；涉及 Channel 时加真实 IM 回读。
纯文档修改无需重新请求模型。缺环境写 `BLOCKED` 及缺项，未运行写 `NOT RUN`，均不转为通过；真实产品失败仍须处理。

# 现有 CodeBuddy 选模专项

[脚本](../../scripts/verify-codebuddy-model-im-live.mjs)不由默认 test 或 CI 调用。
由处理 CodeBuddy 变更的作者在已认证 CodeBuddy CLI、octo-cli、受保护 QA 账号及两 Bot 已加入的测试群环境中显式执行。
脚本会产生真实模型请求及 QA 群消息，使用固定测试 Bot、模型和原生日志格式；本次适用版本、7 个场景、原生请求 ID 和 IM 回读见[217 验收](../tasks/217-codebuddy-model-selection/validation.md)。

```bash
pnpm build
git rev-parse HEAD
git status --short
codebuddy --version
OCTO_CHANNEL_QA_ACCOUNTS=/protected/path/to/octo-im-account.md \
OCTO_CHANNEL_QA_GROUP=<existing-Channel_QA-group-id> \
OCTO_CODEBUDDY_LIVE_REPORT=/private/path/outside-repo/report.json \
node scripts/verify-codebuddy-model-im-live.mjs
```

其他 adapter 沿用各自现有脚本或原生 opt-in 测试，按同一执行责任和证据要求单独报告；不借用 CodeBuddy 或其他 Provider 的通过结果。
例如 [OpenCode IM](../../scripts/verify-opencode-im-live.mjs)、[DSH Kernel](../../scripts/verify-dsh-live.mjs)和 [OpenClaw Gateway](../../scripts/verify-openclaw-compatibility-live.mjs)是不同边界的专项，不等同于所有模型和平台的完整验收。
本轮没有重新验收这些 Provider，也不改变其运行方式。

# 证据要求

任务 validation 和 PR 记录：实际执行者、时间、源码完整 SHA/dirty、平台、Node 与原生 CLI/SDK/Gateway 版本、测试环境、脱敏命令、逐场景结果与清理事实。
适用时附原生 session/request ID、实际请求模型、Host/canonical 终态及完整 IM 回读结论。
报告原生拒绝正确送达，可以证明错误传播，但不能证明该账号或模型可用。
公开材料不得含凭据或私密轨迹；最小必要证据应随任务/PR 可见，不能仅依赖 reviewer 无法访问的本机报告路径。
