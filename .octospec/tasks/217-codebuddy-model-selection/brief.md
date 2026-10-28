---
type: Task
title: CodeBuddy 显式选模、续聊切模与错误送达
description: 在 prompt 前按原生目录设置并确认模型，通过 Gateway 到真实 CodeBuddy 的链路验收。
tags: [adapter, channel, testing]
---

# 目标与责任

处理 [#217](https://github.com/Mininglamp-OSS/octo-runtime/issues/217)，基线为
`origin/main@59cb21a14259b6dc828f8791b8117ba1f3689f4c`。
独立 worktree 为 `octo-runtime-issue-217`，分支为 `fix/217-codebuddy-model-selection`。
用户授权新 worktree、OctoSpec、至少 95 分可执行性评估、实现、本地 verified-review、提交及 PR。
公开 commit 和 PR 使用英文，保留 Git 配置作者并添加 Codex trailer。

业务目标是本轮显式模型实际生效，非法选择及原生拒绝向用户报告失败。
宿主拥有模型选择及配置来源；CodeBuddy adapter 拥有原生映射、确认和失败传播。
省略模型沿用原生默认，不选择替代模型、不换账号、不重置 session、不虚构历史。
所有接入共用 adapter 修复；不向公共 Context/Run 协议新增字段。

# 已有证据

2026-10-28，macOS arm64 / Node 24.19.0 / CodeBuddy 2.177.1：
真实 ACP 新建请求包含 `model=hy4-preview`，响应仍确认 `deepseek-v4.1-flash`；
随后 `session/set_config_option(configId=model,value=hy4-preview)` 返回确认值 `hy4-preview`。
探针未发送模型 prompt，因此不证明付费模型可用。
源码同时确认恢复路径没有 setter；#216 的订阅失败处理已在基线中，不重复实现。

# 实施合同

1. 创建/加载完成后读取本次原生响应目录。优先使用 model 类别的 config option（保留真实 configId，支持分组 options）；没有该项才读取 models.availableModels 并使用 session/set_model。
2. 显式非空模型必须属于广告目录。空目录、缺少目录、未知 ID 均在 prompt 前失败；错误包含请求模型 ID 及选择有效模型的下一步，不静默继续旧模型。
3. 原生已确认同一模型时无需 setter；否则 await setter 后读取本次响应的确认模型。确认缺失或与请求不一致时失败，不用请求值覆盖回执。旧接口空 ACK 不冒充确认；仅在返回原生确认字段时继续。
4. 新建和恢复遵循同一合同，setter 使用本次真实 sessionId。恢复不修改会话身份，不从旧 binding 推断当前模型。模型省略或空字符串时不设置，回执仍只反映原生响应。
5. 目录/切换错误沿既有 Core failed terminal、canonical run.failed 与 Gateway 标准错误文本送达。原生 setter 拒绝保留实际错误；不解析 Provider 私有错误来补造成功或自动重试。
6. #216 的 ACP_MODEL_REQUEST_FAILED、原始 _meta 消息、失败优先级、空输出守卫及 finally 关闭保持有效。每个 invocation 拥有自己的 ACP transport，选择失败也关闭。

# 拓扑与范围

Gateway 宿主原生构造 ImRuntime，调用同一 KernelClient；Kernel 服务在测试宿主进程构造，内部 worker 注册 CodeBuddy adapter，再启动 CodeBuddy CLI。业务存储由测试宿主维护，模型切换通过替换整个 Gateway 配置并复用宿主 session store 验证，不增加逐 Bot 私有热更接口。
仅修改 CodeBuddy 模型适配及对应测试、验收脚本、知识记录；通用 ACP、Kernel、Gateway 生产执行流程和公共接口无需修改。无删除映射或数据迁移。

# 验收矩阵

| 场景 | 必须观察的结果 |
| --- | --- |
| 新会话有效模型，区别于默认 | 目录匹配、setter 确认、真实 Provider 请求模型、Host completed 或原生拒绝、Gateway 送达 |
| 既有 A 切换有效 B | 同一原生 session，下一轮请求 B；若原生拒绝则用户收到具体失败，不执行 A |
| 新会话未知 ID | 无 setter/prompt，Host failed，用户文本含模型 ID 与原因 |
| 恢复后未知 ID | 不执行旧模型，Host failed，用户收到错误；之后有效选择仍可执行 |
| 广告模型的 setter 拒绝 | 无 prompt，失败详情送达，finally 关闭 |
| 广告模型的订阅拒绝 | 实际请求该模型，沿既有 ACP 错误原文送达，不能报告 completed |
| 默认/空模型 | 不调用 setter，保留原生默认及诚实回执 |
| 坏目录/错误或缺失确认/分组/旧 models 接口 | 保守失败或原生确认，JSON 安全，无静默 fallback |
| 清理 | 成功、目录拒绝、setter 拒绝及取消均关闭 transport；后续 invocation 可继续 |

自动化包括 adapter 边界与真实 Gateway -> Kernel IPC -> 独立 worker -> 离线 ACP fixture -> canonical -> Gateway reply；真实验收使用指定 QA 账号与 im-test，单列真实 CodeBuddy session 确认及 CLI 请求日志证据。不以模型自称或成功终态替代实际选模证据。
运行 pnpm typecheck、lint、lint:names、相关回归及 test:suites，检查格式、OKF 和 diff。
verified-review 按实际 diff 逐文件审查并执行行为测试，发现问题修复后重验。

# 可执行性评估

实施准备度 **96/100**，人工方案评估，不是成功率或验收通过率。

| 维度 | 得分 | 依据 |
| --- | --- | --- |
| 根因与责任 | 25/25 | 已有真实 ACP 差异和 setter 确认；修复归 adapter |
| 合同与兼容 | 24/25 | 明确新建/恢复/省略/缺确认合同，隔离 Provider 差异 |
| 实现与测试入口 | 24/25 | Node/pnpm/CLI 可用，已有 Kernel 与 Gateway fixture，QA 路径已提供 |
| 失败、清理及证据 | 23/25 | 拒绝不 prompt、原生证据和订阅回归明确；付费模型可用性仍待真实请求 |

95 分门槛已满足。真实账号上游拒绝是必须保留的验收事实，不能把它改写为有效模型成功。
回滚 adapter 改动即可恢复旧行为，无 Home、账号或配置迁移；不合并、部署或发布。

# PR 218：真实验收与默认门禁分离

用户在评审后明确：真实账号、模型及 IM 访问不进入门禁 CI，其他 adapter 采用同一约定。
用户进一步要求收敛为文档声明。本轮在现有分支仅补说明；决定权属于仓库测试维护者，Runtime 不新增测试执行策略或 Provider 选择策略。

1. 文档明确默认 CI 的 fake Provider 回归与独立真实验收的证据边界，不修改测试、脚本、package 命令或 CI 工作流。
2. 使用已有 CodeBuddy 真实验收脚本及 env 前置条件，明确 non-gating；不接入必需 CI、发行或打包检查。
3. 所有 adapter 的真实验收独立记录，明确变更作者负责执行及归档、reviewer 核对范围；在修改原生映射/确认、会话/权限/工具或升级原生版本时重跑受影响路径。缺环境记 blocked，不报通过。
4. 已有专项不冒充完整矩阵，也不宣称所有 Provider 在本轮重验。证据关联源码 SHA、dirty、CLI 版本、平台、命令、终态、实际请求和清理。

可执行性评估 **96/100**：已有明确 review 选项、实际命令及验收证据，无执行行为变更；其余 4 分为其他 Provider 现场环境与上游可用性，本轮不作通过承诺。
验证仅检查文档格式、OKF/链接、说明与实际默认 CI 及脚本入口一致，核对最终 diff 无源码/测试/CI 工作流变化；不为纯文档补跑真实模型。
