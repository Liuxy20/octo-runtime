---
type: Task
title: CodeBuddy 217 本地 verified-review
description: 记录逐文件静态审查、运行验证、修正及证据边界。
tags: [adapter, channel, testing]
---

# 审查基线与计划

按 verified-review 技能串行完成 Track A 代码审查与 Track B 运行验证。
范围为 `59cb21a14259b6dc828f8791b8117ba1f3689f4c` 至本次工作树（dirty: yes），macOS arm64 / Node 24.19.0 / pnpm 11.19.0。
没有审查 lockfile、生成代码或二进制，因为本次没有此类改动。
最高约束为用户的 OSS 英文提交和 Codex trailer，其次为仓库架构、Adapter/Channel 合同，再使用五维 rubric 与误报过滤。

本次超过 50 行阈值，审查计划先确定以下不变量，再逐文件核对：

1. 模型是宿主本轮显式输入，原生差异属于 CodeBuddy；省略不能触发新产品策略。
2. 新建和恢复共用目录校验，setter 绑定正确 session 并先于 prompt；未知、原生拒绝或未确认均停止。
3. 回执来自本次原生确认；加载后的 native 默认与旧 binding 不同也不能忽略显式请求。
4. 失败通过 Core、真实 KernelClient.invoke、worker、canonical 和 Gateway 文本送达；Provider 失败不被部分输出或 completed 覆盖。
5. transport 所有权与 finally 保留；setter 等待期间取消也关闭，不执行 prompt。
6. 测试和 live 观察不得代替执行，不通过修改底层合同使测试通过；凭据只在内存传递，证据仅保留模型和身份关联字段。

# Track A

逐一核对以下文件及其调用方：

| 文件 | 核对内容 |
| --- | --- |
| packages/octo-runtime-adapter-codebuddy/src/index.ts | 目录优先级、分组、原生方法与 id、确认、旧绑定、失败/取消/finally |
| test/codebuddy-model-selection.test.js | 独立边界、新建与恢复、失败后继续、真实 invoke/Host/送达、宿主 store 所有权 |
| test/codebuddy-outcomes.test.js | 旧“显式模型可被忽略”预期改为当前合同，保留原生未知/默认回执与订阅回归 |
| test/fixtures/codebuddy-model-fixture.js | 故意忽略 new.model；原生状态由 session 隔离，审计实际 prompt 模型，幂等关闭 |
| test/fixtures/codebuddy-model-worker.mjs | 真正 worker 注册 adapter，上游仅为离线 fixture |
| test/fixtures/codebuddy-model-live-adapter.mjs | 真正 ACP 透传，不采集输入/凭据；关闭观察共用真实 Promise |
| scripts/verify-codebuddy-model-im-live.mjs | 测试域名和账号/群门槛、真实 mention、标准 invoke、Host 旁观、逐轮实际请求与 IM 回读、finally |
| .octospec/rules/adapter-metadata.md | 当前新建/恢复选模合同和原有订阅原文例外均准确 |
| .octospec/tasks/217-codebuddy-model-selection/brief.md | 业务归属、可执行性、验收矩阵和旧接口缺确认的保守行为 |
| .octospec/tasks/217-codebuddy-model-selection/context.yaml | 实际读取路径与固定基线 |
| .octospec/tasks/217-codebuddy-model-selection/validation.md | 分开真实成功、预期拒绝、夹具覆盖及工具修正，不冒充付费模型可用 |
| .octospec/journal/shared/2026-10-28-217-codebuddy-model-selection.md | 可复用结论与实际边界 |
| .octospec/index.md / .octospec/log.md | 入口、链接和当前状态 |

静态检查发现的 unknown[] 类型收窄已修正。审查补充了 configId 缺失与 setter 期间取消的执行用例，均通过。
按误报过滤复查候选后，**未发现遗留 medium 或以上问题**。未把无确认就失败、取消保留失败事实、Provider 订阅拒绝等已定义合同列为缺陷。

# Track B

- 同一新增反例先在基线构建复现 10 项失败，修复后通过；没有用退出码 0 宣称旧产品正确。
- 最新专项 55 项全通过；覆盖边界、错误确认、原生拒绝、取消、同 session 切模与有效恢复。
- 最终全量 Node 2105 通过/56 跳过/0 失败，WebUI 35 通过；最终类型、静态、格式及知识库检查通过，见[验收记录](validation.md)。
- 真实 im-test 全链路 7 项完成断言，5 次主 Agent 请求模型逐轮匹配原生回执，非法选择无主 Agent 请求；Host/canonical 一致，完整结果已从群历史回读。
- 默认与订阅拒绝保留 failed，hy3 正常完成，hy4-preview 真正切换后原生拒绝；7 个真实 ACP transport 关闭，Kernel 清理完整。

运行证据、requestId 和复现命令见[验收记录](validation.md)。未覆盖原生 Linux/Windows、其他 CodeBuddy 版本及真实卡片 UI；这些限制不改写为测试通过。

# PR 218 评审后文档复核

基线 `1c3d4856e518244c0e1b4e5d470b0832387be8fe`，范围仅为文档。
原审查未明确核对真实验收的执行责任及非门禁定位，原“无 medium 及以上问题”不能覆盖这个交付说明缺口。
本轮对照 yujiawei 给出的文档方案，核对贡献指南、CI 指南、PR 模板、工程规则、Adapter 导航、真实验收指南及任务记录：fake 回归与真实证据区分，实际命令和前置条件可复用，作者负责执行及归档，受影响原生行为变化时重跑，缺环境不报通过。
最终生产代码、测试、package 命令和 CI 工作流与基线一致；未通过迁移测试或接入真实 CI 来处理此项反馈。文档格式/链接检查结果记录在 validation，草稿阶段触发的原生失败也保留事实，不冒充全部原生验收通过。
