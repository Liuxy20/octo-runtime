---
type: Rule
title: 统一 InvokeInput 合同
description: 所有公共入口共用的输入、默认值和多模态字段。
tags: ["invoke","protocol","multimodal"]
timestamp: 2026-11-05T10:45:00Z
implementation_baseline: df63c8f
id: runtime-invoke-input
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["apps/cli/**","packages/octo-runtime-executor-core/**","packages/octo-runtime-protocol/**","packages/octo-runtime-executor-kernel/**","packages/octo-runtime-host-sdk/**"]
  touches: ["invoke","protocol","multimodal"]
source: self
supersedes: []
---

# 平铺 invoke 与 IPC v2

KernelClient.invoke(inputs, sessionId, providerSession, agentEnv) 返回 KernelInvocation。inputs 普通为 ModelInputPart[]；高级 InvocationContent 只包含 parts、输出视图、内容/恢复材料、追踪身份和代次，不包含执行设置、会话参数或 signal。

agentEnv 包含执行信封和高级执行字段 agentSource/workdir/approvalMode/agentConfig/runtimeLimits；顶层旧执行字段与 contexts 拒绝。client 在调用时校验、复制并确定 ID，首次消费才提交。原配置和 inputs 可复用，不随本次执行改变。协议 schema、TypeScript 和语义校验须一致；生成文件由 schema 脚本生成。

应用提示词是调用方准备的普通输入，不属于 agentEnv。Issue 334 删除 octo.control/instructions、controlInstructions、两个指令 payload 类型及派生/首轮注入 helper；不换名、不兼容转发，旧项/字段即使为空也明确拒绝。输入文本和图片保序，不加提示词或分隔符。新建、续接和显式 fresh fallback 各由调用方选择完整输入，Runtime 不按会话状态注入。独立 Gateway 尚须迁移自己的配置和编译入口，Runtime 单仓验收不代表仓外迁移完成。

工作目录按 Issue 335 由调用方先成功创建，再显式提交已存在的绝对 workspace.path 或 agentEnv.workdir；重复入口须一致。CLI 与 SDK 都不默认取 cwd，Runtime 不选择、创建、替换或恢复应用目录。workspace payload 仅含 path，旧 mode 和随机分配合同删除且拒绝，不留兼容层。Provider 执行前的路径失败保留 WORKDIR_REQUIRED/INVALID/NOT_FOUND/NOT_DIRECTORY/UNAVAILABLE 原因码及 OH-ADP-3004 分类；续接/fallback 缺目录同样失败。外部/preset Agent 与 metadata.workspace:false 的无本地覆盖场景允许缺省。运维 Home/log/IPC 的所有权独立。

IPC v2 的 InvokeInput 使用 inputs/agentEnv，sessionId/providerSession 及内容/追踪字段平铺。旧 IPC v1 明确拒绝，不通过兼容包装恢复旧业务 Context。内部 InvokeRequest 供 Core/Adapter 使用，不作为普通调用方 API。

中断为 client.interrupt(invocationId, reason?)；公开 invoke 不含 signal。身份立即可读。未提交时阻止写出并返回可验证未提交错误；已发送则确认/查询同一接纳身份，再控制原执行，不重放。return/throw 在提交前释放登记；已接纳后停止观察不能自动取消执行。详细所有权和并发上限见[本地执行](local-execution.md)。

文档必须区分 sessionId、invocationId、runId、providerSession、stream_id、seq、kernel_instance_id，以及各自生产者、保存者和用途。client 输入容量 32 MiB、登记 128；信封原有数量/JSON/大小限制不变。
