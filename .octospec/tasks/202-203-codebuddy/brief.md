---
type: Task
title: CodeBuddy 默认模型与失败终态修复
description: 修复默认模型 JSON 回执及丢失订阅错误的问题，通过 Kernel 公共入口验收。
tags: [adapter, protocol, testing]
---

# 目标与责任

联合处理 #202、#203，基线为最新 `origin/main@aac7ec7765ec055eff02328babefcf5d719c0c6a`。
worktree 为 `.worktree/octo-runtime-codebuddy-202-203`，分支为 `fix/codebuddy-202-203`。
用户已授权规划、issue 评论、实施测试、提交与 PR；不自动合并或发布。

用户需要默认模型能实际运行，订阅到期能获得准确错误。模型选择、新建/续接会话与账号管理由宿主和 Provider 决定；原生事件转换属于 CodeBuddy adapter。
调用方显式提交 inputs、adapter、可选 model/providerSession。adapter 最先违反 JSON 回执和真实终态合同，因此在 adapter 修复，不要求 Host 强制模型或放宽校验。
所有 SDK/CLI 消费者共享修复，但不增加产品默认、重试、自动续费、账号切换、会话重置或新的公共协议。

## 实施方案

1. 模型回执只读取 `session/new` / `session/load` 的确认字段：`configOptions` 中 model 的 `currentValue`、`models.currentModelId` 或 `model`。未确认时省略 model，不把请求或旧 binding 当作已应用事实。保留原生新建模型参数及续聊不重设模型的行为，覆盖 #148 的相关回执边界。
2. 解析 `prompt_result._meta` 的 `codebuddy.ai/outcome` 与 `codebuddy.ai/errorMessage`。Provider 声明失败、拒绝或携带非空错误时，生成一个 `run.failed`，优先于空输出守卫；部分文本不能把失败变成成功。
3. 按用户 2026-10-28 最新要求收敛：使用独立的 `ACP_MODEL_REQUEST_FAILED`，映射公共目录 `OH-PRV-4010` 及公共消息。实际 message 为公共消息加换行及 `JSON.stringify(原始 _meta)`；不再提取白名单 providerError 或从详情推断新的错误类别。不解析错误 JSON、不脱敏、不筛选字段，缺失/损坏/非对象内容也按原值序列化。用户已确认失败识别仍沿用 ACP 明确的失败信号，不能仅因成功结果携带 _meta 就判失败。
4. 已声明的 ACP 请求失败统一为此错误码，不因上游 JSON 含 quota、HTTP 429、认证或超时文字而改成其他类别；不自动重试。公共目录登记该码，Core 对此码保留原始消息；其他错误仍走原有归一化和脱敏。
5. 成功必须有 final 文本；允许复用通用 ACP 已支持的结果正文形状，在没有流式 final 且没有失败时补出正文。空/仅思考/仅工具不能成功（#147）。取消继续是 cancelled；Provider 明确失败优先于同时出现的取消标记，避免隐藏已知订阅错误。结束未闭合工具及模型步骤，保留现有传输关闭所有权。

## 验收矩阵

- 默认配置、空 agentConfig、显式模型：均到达 prompt；每个原始 session.update 在序列化前通过 JSON 校验。
- 新建及续聊的未知/确认模型、续聊请求不同模型：回执仅反映确认事实。
- 捕获的订阅失败：唯一 run.failed、Host failed、无 run.completed；公共消息后保留 meta JSON 中的中文续费提示及原生详情，统一 ACP 错误码、不可重试。
- 缺失/损坏/非对象错误、refusal、失败伴随部分输出、HTTP 429、类凭据文本与未知字段：失败语义不变；原始详情完整保留，错误分类不依赖内容。数字/对象 stopReason 不得抛类型异常，adapter/Core/Kernel 路径覆盖。
- end_turn-only、reasoning-only、tool-only：ACP_NO_FINAL_OUTPUT；正常流式文本、结果正文、取消及工具取消保持正确。
- 通过 AgentExecutor 及 `createKernelService` + `attachKernel` + submit/subscribe/invoke 的实际 worker/IPC 验证，不仅消费 adapter。
- 原始消息例外仅限 `message` 字符串，外层字段继续公共脱敏；普通或自定义 Adapter 携带同一错误码时也不能绕过外层处理。
- 按依赖顺序构建，运行相关测试、lint、命名、格式、typecheck、全量测试；PR CI 平台结果单列。

## 可执行性评估

实施准备度 **96/100**，是人工方案评估，不是成功率或测试通过率。

| 维度 | 分数 | 依据 |
| --- | --- | --- |
| 根因与责任 | 25/25 | 最新源码仍存在 undefined 回执和无条件成功；两个 issue 提供可重放输入。 |
| 实现与兼容 | 24/25 | 修改局限 CodeBuddy，复用公共脱敏、分类与 ACP 步骤；上游可选元数据仍需保守处理。 |
| 验收可执行性 | 24/25 | Node 24、pnpm、gh 可用，真实 Kernel fixture 可直接装配 adapter；原生跨平台结果待 CI。 |
| 失败与安全边界 | 23/25 | 白名单、脱敏、失败优先级、取消与关闭均有明确验收；真实账号复测尚未进行。 |

## 范围外与回滚

不修改通用 ACP、Kernel 或 failure schema；只在公共 failure 目录登记独立 ACP 错误码，Core 对此码的消息原样保留。不新增模型切换 RPC，不修改外部 Work App，不管理 Provider 登录或订阅。
回滚本次 adapter 改动即可恢复旧行为，无配置、身份、Home 或数据迁移。
自动化使用离线 Provider fixture；不将其写为真实 CodeBuddy 或真实 IM 联调。
