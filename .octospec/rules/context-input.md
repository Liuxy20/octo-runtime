---
type: Rule
title: 本轮模型输入与工作目录
description: Context v3 的执行配置与调用方普通提示词输入边界。
tags: ["context","model-input","workspace"]
timestamp: 2026-10-22T00:00:00Z
implementation_baseline: df63c8f
id: runtime-context-input
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","packages/octo-runtime-executor-core/**","packages/octo-runtime-adapter-*/**","test/model-context*"]
  touches: ["context","model-input","workspace"]
source: self
supersedes: []
---

# 模型输入和执行环境分离

公开入口为 KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)。inputs 是业务方已经准备好的有序文本/图片；Runtime 不读取、拼装、渲染业务历史、extra.* 或资源引用，不规定业务标签格式。Gateway/应用可选 namespace/XML/Markdown，均只是输入内容。

agentEnv 复用 Context v3 schema/items 执行信封，承载公共执行 bean 和宿主与 Adapter 约定的私有 item；业务材料和应用提示词由 inputs 传递。cwd、Adapter、model/effort、envs、MCP、limits、审批属于 agentEnv；Core 每轮复制快照并保序透传，Adapter 直接读取与校验，不改变原配置，不从其他调用补齐业务材料。

应用启动提示词由调用方与业务材料、当前文本/图片一起构造为普通 inputs，内容、顺序和每轮是否携带均归调用方。Runtime 不提供可移植 system/developer/受信提示词抽象，不按新建、续接或重建会话添加提示词、标记和分隔符。Provider 私有能力的存在不构成 Runtime 公共注入合同。

Issue 334 删除 octo.control/instructions、controlInstructions 及派生/首轮注入 helper，不保留别名。旧项在通用 Context、配置持久层和 agentEnv 拒绝；旧字段即使为空也拒绝，不能静默丢弃。主输入、modelInput 与显式 fresh fallback 各由调用方完整准备，重试复用同一冻结内容，不重复前置。历史图片不可用必须显式失败，不静默退化。MCP 和环境变量不得因提示词迁移进入正文。

Core 内部 InvokeRequest 和 Adapter signal 保留为执行接口，不等同于公开 KernelClient 签名。详见[输入合同](invoke-input.md)、[调用与取消](local-execution.md)、[标识说明](../../docs/zh-CN/concepts/identifiers.md)。

## 调用方准备目录，Runtime 只校验并执行

本地执行必须显式提供已存在的绝对目录：octo.execution/workspace payload 仅为 {path}。SDK 与 CLI 均无隐式 cwd，Core/Kernel 不分配目录、不创建缺失路径、不从旧会话补目录。调用方临时目录须先成功创建再传入；续接和 fresh recovery 路径消失明确失败，不替换或重建。

Issue 335 删除 mode 的 fixed/random/none 分支、workspace_mode 回执/投影字段、prepareRunContext 和 WorkspaceAssignments；旧 payload 明确拒绝，不兼容转换，不删除历史用户目录。Adapter 在 Provider 操作前校验路径，稳定原因码为 WORKDIR_REQUIRED、WORKDIR_INVALID、WORKDIR_NOT_FOUND、WORKDIR_NOT_DIRECTORY、WORKDIR_UNAVAILABLE，沿用公开分类 OH-ADP-3004。外部/preset Agent 或 metadata.workspace:false 没有本地覆盖时允许缺省，OpenClaw 使用 Provider 工作区；Runtime Home/log/IPC 等自有目录继续独立管理。
