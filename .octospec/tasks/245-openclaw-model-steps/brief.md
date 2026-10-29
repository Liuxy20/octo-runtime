---
type: Task
title: Issue 245 OpenClaw 模型轮次与工具归属
description: 修复 Gateway 转 canonical 时模型轮次合并及工具归属缺失，改善执行卡片过程展示。
tags: [openclaw, adapter, protocol, testing]
---

# 目标

从最新 `origin/main@ba2a706380bf244bc428b3465c0487c5b58e6975` 建立独立 worktree 与分支 `fix/openclaw-model-steps-245`，落实 [Issue 245](https://github.com/Mininglamp-OSS/octo-runtime/issues/245)。同一次 OpenClaw run 中的多次模型调用映射为现有 CanonicalEvent 的独立 model_step；消息与工具的开始、增量和结果保持所属 step，卡片随实际过程推进。

## 产品意图与归属

- 业务目标是忠实展示执行进度；业务方仍决定任务、模型、权限和卡片呈现策略。
- Adapter 负责 Provider 原生事件到既有协议的映射；本次不增加协议字段、公共 API、产品开关或卡片推测逻辑。
- 原生 thinking 中出现 HTML/代码可接受，继续作为 thinking；实际工具参数和输出保持工具事件类型。
- 服务拓扑与资源所有权不变：CLI Playboard 原生创建临时 Kernel，内部 worker 执行 Adapter；Adapter 拥有本次 Gateway 连接及事件状态，不接管 Provider 进程、用户会话或工作区。

## 关键合同

1. 原生 run 终态与单次模型调用结束分别处理；`length` 续跑、工具批次与可识别的原生重试不合并为一轮。
2. 每个已开始 step 恰有一次匹配结束；未知字段、重复通知、迟到工具结果不能制造额外轮次。
3. 原生消息完成通知按当前 session/run 关联；共享续聊时不以到达时间冒认旧消息。
4. 维护 `toolCallId -> stepId`，并行工具属于发出它们的同一轮；后续轮开始后到达的结果仍更新原工具。
5. 对流式快照和持久消息做身份去重；不重复追加正文、工具或 usage。收尾沿用原生终态确认及取消/断线对账合同。
6. 不读取 SQLite 或本地 transcript 作为生产实现依赖；原生协议差异由 Adapter 内部处理。
7. `finalText`/IM `finalMsg` 只投递最终回答且仅一次，不能混入过程正文、thinking、工具参数/结果或错误 payload。过程 assistant 正文映射既有 commentary，不能先发 final 再依赖消费者猜测最后一轮；有原生最终可见正文时优先使用，显式空正文不能回退为过程文本。
8. 保留 2026.7.1 至 2026.10.8 已核验合同；版本不作为接入门槛，不维护逐版名单、最低版本或未知版本拒绝。可识别的上游日期版本按 2026.8.1 权限字段变更点选择旧版和新版请求；独立版本号的 fork、dev 或缺失版本按当前 stage 尝试。hello 中实际协议 v4、必需方法和事件决定基础可用性，各功能按实际能力/响应处理，原生 commentary/final_answer 为可选标记。无法保证仅凭 WS 连通即可兼容任意 fork 的全部 RPC 字段；真实 RPC 失败保留诊断，不自动重发。

## 验收

- 本地手动 fixture 验证 thinking-only/length 续跑、多工具、结果迟到、重复通知、快照替换、旧 session 消息隔离和终态配对。
- 回放实际 Adapter -> ImRunProjector -> reasoningPhases，断言中间卡片轮次和工具归属，而非仅断言最终计数。
- 最终正文精确值、仅一次投递、有/无原生 phase 及 7.1 丢失 reasoning 标记的最终 payload 单独覆盖；固定版本源码合同与手动事件形状回放区分记录，7.1/本机版本/最新版真实 Playboard 验证。
- 运行既有 OpenClaw 回归、构建/类型/静态检查；专项不加入默认测试或 CI。
- 使用本机 OpenClaw 经 Playboard 创建独立 QA session，执行至少两批有依赖的无害工具调用，记录真实中间事件与清理结果；不发送 IM、不修改 Gateway 配置或常驻服务。
- 按用户指定 `code-review` 技能进行 Standards 与 Spec 两轴审查，修复发现后复验；最后提醒用户本地真实卡片验收。

## 范围外

其他 Adapter、协议升级、卡片模板改造、模型质量与原生 thinking 内容过滤。禁止扩大 GitHub CI 的 workflow/job/matrix/trigger/gate/default test 范围。

## 后续授权与交付

2026-10-29 用户已授权本分支构建、全局安装和本地服务重启；两次安装完成后由用户在真实 IM 验收。用户确认 hello.md/world.html 的最终正文符合预期。卡片未显示完成时，运行日志已有 completed，卡片编辑返回 HTTP 400；用户明确由其他 PR 修复，本特性不处理该问题，也不因附件投递失败改变执行终态。

用户进一步授权等待 PR #244 合并后，从最新 main rebase，完成验证和 code-review 两轴审查，提交英文 commit、普通 push 并创建英文 PR。新 PR 当前 head 获两名不同 reviewer 的有效正式 Approve、既有必需检查通过且无未处理阻塞意见后可合并 main，无需再次确认。保留配置 Git author，Codex 实施提交及最终 squash 提交包含恰好一次 Codex co-author trailer；不强推、不绕过分支保护、不删除本地 worktree。

PR #244 已于 2026-10-29T10:53:37Z 合并，最新 main 为 01d0ca5d3f62f1e9dc5999ed84da4797e9acafef；开始按上述授权交付，不额外全局安装或重启服务。

2026-10-29 用户指出精确版本白名单无法适应第三方每日发版和 LobsterAI 等独立版本号的魔改版，要求消除逐版维护、按功能 stage 兼容，认为此问题按 P0 优先处理。此需求覆盖原先拒绝所有未知未来版本的约定。兼容性判断归 Adapter：保留握手能力检查与两代原生字段映射，移除精确版本准入表；新版本 RPC 报错仍保留原始诊断，不删字段重试或重发任务。按用户授权实测 7.1/8.1/10.8 核心变更阶段，离线合同回放与真实 Provider 验证分别报告，不声称已实测所有未来版本或 LobsterAI。

用户随后明确架构边界：标准 OpenClaw 与 fork 不混合维护；fork 若有协议差异，单独新建 Adapter。FDE 固定版本可独立定制开发，按选定版本验收，不要求通用 Adapter 承担同等前向兼容责任。当前仅删除标准协议连接的版本门槛，不添加任何 fork 产品特判或专用适配。
