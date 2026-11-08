---
type: Rule
title: 会话归属与 reset
description: 业务会话、执行身份与 Provider binding 的职责。
tags: ["session","reset"]
timestamp: 2026-10-19T00:00:00Z
implementation_baseline: df63c8f
id: runtime-session-reset
tier: repo
priority: 90
load_bearing: true
inject_when:
  paths: ["packages/octo-runtime-protocol/**","test/*session*"]
  touches: ["session","reset"]
source: self
supersedes: []
---

# 业务会话与执行身份

业务方拥有 conversation_id 到逻辑 session_id 的映射、reset 规则及 Provider binding 存储。Runtime 消费调用方明确给出的 session/generation 与 opaque Provider session，不管理聊天历史，不从旧请求补背景。Run 7 与 Context v3 独立版本保持不变。

sessionName 是展示名称，不是恢复句柄、权限或 registry key；同名不合并，续聊改名不切换原生会话。Core 仅在省略时补随机 UUID。调用方决定新建、续接、继承或 reset，框架不从缺省值推断产品操作。

业务 reset 与执行取消是两个动作。消费者更换 binding 后须隔离旧代次的迟到更新；Runtime 对原调用保持其冻结身份和实际执行终态。Provider 返回 sessionId 不保证下次恢复成功，真实失败按执行合同返回。

agentEnv 是本轮配置，不是 Provider binding 的身份或 hash。providerEpoch 可选且归业务维护；是否替换 binding 由业务判断，不要求任意配置变化递增。使用 epoch 时将原值保存到异步问题快照；省略时须由业务使被替换绑定的旧表单失效，SDK 不检测隐藏配置变更。正常完成后的续跑配置由宿主显式授权，详见[异步续跑边界](protocol-design.md#异步续跑配置与身份边界)。

业务方负责下一轮所需背景、持久性、数据保护与历史展示。Runtime 不依赖 SQLite，不提供业务 store/数据库适配/迁移，也不读取或自动删除旧用户数据库。

Octo 渠道的 reset/new/stop、群与话题身份、调度额度、会话缓存和历史窗口已归[独立 Gateway 仓库](https://github.com/Mininglamp-OSS/octo-channel-gateway)，不作为 Runtime 当前业务定义。迁移依据见[Issue 328](../tasks/328-remove-extra/brief.md)。

执行底座验证见[无数据库回归](../../test/stateless-executor.test.js)、[会话名称](../../test/session-names.test.js)。
