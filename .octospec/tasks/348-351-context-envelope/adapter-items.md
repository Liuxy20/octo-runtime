---
type: Design
title: 各 Adapter 私有 AgentEnv.Item 的实施合同
description: 固定原生模式的包内字段、缺省、校验与审批关系，为实施提供可验证依据。
tags: [adapter, context, protocol, planning]
---

# 合同状态与归属

这是 #351 的实施设计记录，现已实施。下列字段选择属于对应 Adapter 包的私有 API，不登记公共 Schema/catalog，不导出统一 Mode 类型。各段合同已写入对应包 README.md 和 README.zh.md，包 README 为权威文档；本文件留作本次设计记录。公共 SDK 文档只链接这些包，不复制字段表。adapter.xxx 是包私有命名选择，不是公共协议命名规范。

各包从本次 `agentEnv` 只读其自身 `options` payload。通用 `agentEnvItem()` 仅负责取值，不承担私有语义。缺少 item 或缺少新字段表示没有本轮模式覆盖；显式 null、空字符串、错误类型或不支持值由消费包拒绝。现有 options 的其他有效字段继续保留，不能用只包含新字段的白名单误删已有设置。凭据仍走既有可信连接通道，不混入本次新增模式字段。

## Codex

- 位置：`adapter.codex/options`，新增 `collaborationMode?: "default" | "plan"`。此枚举只在 Codex 包内定义，表达当前原生模式，不代表所有 Adapter 的能力。
- 缺省：不调用 collaborationMode/list，不向 turn/start 添加 collaborationMode。不会主动重置已恢复线程的原生模式。
- 显式配置：调用已有 collaborationMode/list，要求原生返回集合包含请求值；不支持时明确失败，不再把 plan 自动替换成 default。构造 turn/start 的原生 collaborationMode 仍在 Codex 包内完成。
- 原生 settings 要求 model 时，优先使用公共 model 中的显式 ID，否则使用当前 thread/start 或 thread/resume 返回的有效模型；不存在时明确失败，不猜模型。reasoning_effort 使用本轮显式 effort 或原生线程值/null。此处满足原生必填结构，不修改 agentEnv，也不是恢复已删除的 use_provider_default。
- model/effort 仍属原有公共 bean；私有 mode 不覆盖公共 approval_policy 或 sandbox 校验，不新增受信提示词入口。
- 验收：缺省零 mode RPC；显式 default/plan、Provider 不广告请求模式、缺少有效模型、RPC 失败和恢复线程分别捕获请求并检查结果。

## Claude Code

- 位置：`adapter.claude-code/options`，新增 `permissionMode?: "plan"`。本轮只迁移已有原生 plan 功能，不新增绕过审批的私有设置。
- 缺省沿用现有公共审批映射：ask → default，assisted → auto，full_access → bypassPermissions；原生 --permission-mode 仍需传入，不能把“无额外模式动作”误写成完全不传此参数。
- 显式 plan 时使用 --permission-mode plan，优先于上述审批到 CLI 参数的映射；即使公共模式为 full_access，也不追加 --dangerously-skip-permissions。现有 interaction responder 和授权校验继续执行。
- 私有字段中的 default/auto/bypassPermissions 等值均拒绝；恢复普通执行通过省略此字段，再由公共审批合同决定。这个范围与当前已实现能力相符，不将整个原生权限面一起暴露。
- 原生 init.permissionMode 用于验证 Provider 实际状态；需要提示未确认时使用已有 provider_diagnostic 通道，不恢复统一 actmode 回执。
- 验收：plan 与三种审批档位的组合，省略后的原参数映射，非法/空值，原生 init 缺失或返回不符，以及 native/canonical 路径。

## 通用 ACP 与使用它的包

- 位置：`adapter.<实际 metadata.type>/options`，字段 `modeId?: string`。`createAcpAdapter` 在 ACP 包内读取和处理；Hermes、Kimi Code、MCode、Qoder CLI、Qoder CN、OpenCode 等各包 README 明确自己采用的约定和限制。普通 SDK/Core 不读取 modeId。
- modeId 是非空、非纯空白的原生 ID，按原值精确匹配，不 trim 后改写，也不把 default 映射为 build。删除 `acpActmodeSelectionRequest` 的公共模式映射；在 ACP 包内保留按原生 ID 选择的 helper。
- 有模式 config option 时，使用广告的 configId 和 options（包含分组）；否则使用 modes.availableModes。无候选、请求 ID 不存在、configId 无效或 RPC 拒绝均失败，不选择其他模式。
- 当前广告值已经等于请求值时不发 setter；否则使用 session/set_config_option 或 session/set_mode。RPC 成功仅说明设置请求已被接受；只有原生返回实际状态时才能说已确认，不能凭请求值伪造回执。
- modeId 不改变 permission responder、full_access 或 Provider 启动参数。模式不能当作新的审批授权来源。
- OpenCode 特例：ask 路径已有 ACP 模式设置，可消费该字段；full_access 当前走 JSON CLI，没有本次已验证的 modeId 载体。该路径遇到显式 modeId 必须在启动前报不支持，不能忽略、改变审批档位或为此切换传输。其他未接入通用 ACP 模式 helper 的 Adapter（如独立 CodeBuddy 实现）本轮不增加功能。
- 验收：配置选项/旧 modes 两种原生广告、分组选项、当前值相同、任意原生 ID、无广告/错误 ID/RPC 拒绝，及 OpenCode 两路径差异。

## Grok Build

- 位置：`adapter.grok-build/options`，字段 `modeId?: "default" | "plan"`，类型和读取在 Grok 包内。
- 沿用该包当前特例：无需 modes 广告，显式配置才发送 session/set_mode；缺省不发 setter。仅接受本包已接线的两个原生 ID，失败返回真实错误，不静默改为其他模式。
- Grok 内部 selectActmode 钩子改为本包原生模式操作，移除对跨包 `acpActmodeSelectionRequest` 的统一模式依赖；与 generic ACP 的原生传输共用不产生公共 bean。
- 私有 mode 不修改其已有 approval_policy 到 yoloMode 的映射。Provider 的 exit_plan_mode 原生交互继续按原机制处理，不纳入公共 actmode。

## DSH 与未接线的 Adapter

删除 DSH 对公共 actmode 的读取和对应错误映射，不新增 DSH mode item。其他当前未消费公共 actmode 的 Adapter 不凭此次清理新增 plan 功能或原生探测。是否实现某个私有功能由该包决定。

## OpenClaw

- 继续采用 `adapter.openclaw/options` 中已有的 agentId；沿用本包既有 nullish 缺省行为，省略或 null 采用 main。本次新增模式字段的 null 拒绝规则不改变这个既有行为。
- 原生 ID 校验保持当前 `^[a-z0-9_][a-z0-9_-]{0,63}$`；空字符串/非法标识失败。验证已有 Agent，缺失失败，不自动创建或替换目标。
- 续接时 session key 前缀和回执中的 agentId 必须与所选目标相符；不因为删除 source 而放宽目标归属。
- metadata.workspace:false 继续表达无需本地 cwd，来源 preset/provisioned 从默认项、metadata 和文档中移除。
- 把字段、缺省、目标验证、续接约束、原生工作区和完整组合示例维护于 OpenClaw 包 README；公共文档只说明 opaque item 机制并链接，不重复维护 OpenClaw 字段合同。既有连接参数及私有选项不因这次文档归属调整更改语义。

## 旧输入与回执

不建立旧 actmode 到上述私有配置的转换。不把新字段注册到公共 catalog。通用信封接受未知 opaque item 不代表对应 Provider 应用了它；迁移说明必须明确旧公共 actmode 不再生效，调用方须改用具体包合同。

删除统一 evidence 的详细清单见 [消费者审计](consumer-audit.md)。canonical 只在需要报告不支持/未确认时复用现有 run.notice/provider_diagnostic，native 保留原生消息；不新增固定“模式证据”事件或三态抽象。原生交互、plan.updated 计划内容与 session evidence 均有独立用途，保持原合同。
