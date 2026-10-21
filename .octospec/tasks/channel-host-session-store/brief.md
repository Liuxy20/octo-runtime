---
type: Task
title: Gateway 宿主会话存储与 Extra 公共合同
description: 基于最新 main 整合 Issue 57、PR 65 和 Issue 66，规划宿主存储接线、资源所有权及公共入口验收。
tags: [architecture, extra, lifecycle, channel, session, reset, storage]
---

# 目标

宿主显式提供会话存储工厂后，真实 Channel Gateway 必须逐 Bot 使用其返回的句柄；宿主关闭并重开同一 SQLite、重新创建 Extra 后，同一业务 scope 和聊天对象恢复原逻辑 session 及可恢复的 Provider binding。显式工厂失败不能降级到 Memory。

先规划，随后用户明确授权实施、提交并合入 main，真实宿主测试由用户在合入后执行。基线为 `origin/main@0c1d1c99c90a85c715212de6e55858a41924f058`，分支 `feat/channel-host-session-store`。需求来源为 [Issue #57](https://github.com/Mininglamp-OSS/octo-runtime/issues/57)、未合并的 [PR #65](https://github.com/Mininglamp-OSS/octo-runtime/pull/65)（`0c50ea96e4b162a89277a02f7bf182cd75bd5f10`），以及 [Issue #66](https://github.com/Mininglamp-OSS/octo-runtime/issues/66) 的 API 与生命周期约束。实际实现及验证状态见[实施记录](implementation.md)。

## ImSessionStore 的用途与接入收益

`ImSessionStore` 保存 Gateway 的会话绑定、历史/规则准备状态、消息处理及 reset 去重记录，让 Gateway 知道某个 Bot 在某个聊天对象中应继续哪个逻辑 session 和 Provider session。CLI 默认使用内存，重启后绑定丢失；本任务允许 Electron/Buddy 主进程通过 `dependencies.createSessionStore` 提供自己的 SQLite 实现，使已保存的绑定能在重启后重新读取。数据库由宿主维护，Gateway 只使用和释放逐 Bot 句柄。

外层 [SDK Gateway 指南](../../../SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)已补目标装配示例，业务类型统一归现有复数 `/extras/channel-gateway`，不增加 `/extra/channel-gateway` 别名或污染通用 `/extra`。用户明确要求源码 submodule 跟踪并更新到最新远端 main；不使用本任务或 #65 的功能分支作为接入前提。工厂实现合入 main 前，文档中的该能力保持待实现标记。

详见 [用途、数据范围与 Electron SQLite 接入说明](session-store-explained.md)，其中说明 dependencies 与 JSON config 的区别、默认内存与宿主存储的收益和代价。接口包含文本和可选请求快照；宿主必须明确保留及保护策略。持久绑定不等于恢复未完成 Run，也不保证 Provider 原生会话一定可恢复。

## 产品意图与修复归属

- 业务目标：Buddy 等宿主已有存储不能因 Gateway 装配缺口而失效。持久化方式、scope、数据库和加密由宿主决定；Gateway 拥有绑定读写及逐 Bot 句柄使用周期。
- 显式输入：已校验的 Bot JSON 配置、宿主的 `createSessionStore` 函数及其返回句柄。归属只来自可信配置，不能从入站消息的路由字段选择数据库或租户。
- 最先违反合同的模块：Gateway Extra 与 Manager 没有消费工厂，`ImRuntime` 因此选择 Memory；不是 SQLite 或 IPC 序列化故障。
- 合同内动作：接通依赖、保留不透明聊天 key 和既有 reset/generation 语义、按已有停止期限完成尾写和句柄释放。
- 越界动作：Core/Kernel 建业务数据库、自动补历史、恢复旧 Run、改变 workdir、重写 Provider thread、让其他 Extra 自动采用 Gateway final 策略。
- 其他产品：未配置工厂继续默认 Memory；直接注入 `sessions` 继续借用；WeCom/WebUI 和普通调用方不新增存储要求。

## 关键合同

1. **当前入口为原生服务。** 使用 `/host` 的 `createExtraService({ endpoint, module, config, dependencies })`，再 `initialize/status/close`；插件保留 `extra(ctx, jsonConfig)(dependencies)`。#57 的三参数 `runtime.loadExtra` 已由 main 的 #74 删除，保留其依赖注入意图，不恢复旧 daemon、runner 或兼容包装。
2. **业务类型归业务入口。** `GatewayDependencies extends ChannelDependencies` 定义于 Gateway；工厂为可选同步 `(config: JsonObject) => ImSessionStore`。模块与依赖涉及的类型从 `/extras/channel-gateway` 导入，`/extra` 不增加 Gateway 专属字段或导出。独立 Extra 定义自己的依赖，无需修改共享 loader。
3. **配置快照与隔离。** 每个启用且有效的 Bot 获得独立句柄；工厂输入是独立深拷贝，保留宿主 scope 扩展字段。无效/禁用 Bot 不调用工厂；旧实例完整释放前不调用替代工厂。
4. **所有权明确。** 工厂句柄由 Gateway 释放；`close` 只释放该句柄，不关闭宿主数据库。内部直接注入的 `sessions` 是借用，与工厂互斥。默认 Memory 由 Runtime 自己关闭。
5. **停止不等于立即撤权。** 先停准入和请求取消，既有消费者在共同期限内完成绑定、gap、规则状态和业务收尾，再撤销句柄访问并释放。到期立即禁止新访问，超时或失败保留 incomplete 与旧实例所有权。
6. **一份执行机制。** 复用当前 `KernelClient.invoke` 和原生 Extra 服务排空，不恢复 #65 的 `LocalExtras` 执行桥。Gateway drain 最多 3 秒、整体共用最多 4 秒单调预算，可继承更早截止；不重新增加旧 PR 的 5 秒计时器。
7. **真实失败。** 工厂抛错、无效接口、错误的 async 工厂、存储操作及 close 失败均可观察；清理失败必须到达服务 `complete=false`，不得仅留 Bot 状态后允许同名重建。诊断不包含凭据或原始数据库错误。
8. **新旧会话语义一致。** 透传全部必需方法和可选 `patchGap/invalidateRules/patchRules`；缺少可选能力时保持现有保守策略。旧代次迟到写入不能覆盖新 binding；不承诺 Provider thread 永不变化或重启后恰好一次投递。

## 服务拓扑与资源

| 位置 | composition root / 实现 | 拥有资源 |
| --- | --- | --- |
| CLI Gateway 服务进程 | CLI 直接调用同一 `createExtraService` | Extra 服务、IM 连接、其 client 和调用、默认 Memory；默认不注入数据库 |
| Electron/其他原生宿主 | 宿主进程直接构造同一服务并注入工厂 | 宿主拥有 SQLite、认证及 scope；Gateway 拥有工厂句柄 |
| Kernel / worker | 现有 Kernel 服务 / 唯一 AgentExecutor | 执行与有界源窗口；不接收存储函数或句柄 |

Gateway 只借用指定 Kernel 的执行服务；关闭 Gateway 不关闭共享 Kernel、兄弟 Extra、无关 Run 或宿主数据库。整个 octo-runtime 不依赖 SQLite，不提供 SQLite 适配实现、表结构或迁移。SQLite 驱动、连接、落盘和真实数据库集成测试均归宿主；库内新增测试使用不依赖 SQLite 的宿主 store 替身。

## 范围外

不实现 SQLite 表结构/迁移、历史导入、持久 outbox、Loop Extra、Go 客户端、通用存储协议或独立进程迁移。不扩大到其他共享导出的全面整理，不更改 Run 7 / Context v3、默认准入、固定目录和 Provider 恢复策略。不删除身份、Home、profile、配置或用户数据。

## 验收与实施入口

详见 [设计与实施步骤](plan.md)、[逐项验收矩阵](acceptance.md) 和 [源码与 PR 复用依据](findings.md)。库内实现阶段验证真实 Gateway Extra + 宿主 store 替身、当前原生服务 + 实际 Kernel IPC、包外 tgz 的严格类型与加载；宿主侧另验 SQLite 重开及真实持久恢复。替身只证明接口消费，不能代替数据库持久性。自动化、真实 IM/Provider、平台及 Buddy 联验分别记录。

当前没有阻塞规划的产品决策。Buddy 的具体表结构、驱动、固定发行版本及联验账号由消费团队提供；库内可以先用宿主测试实现完成合同验收。发布到 npm 和消费方最终验收仍是后续交付步骤，不能以本轮规划或旧 PR 测试结果代替。

用户已授权实施、提交、推送、PR 和合入 main；未授权 npm 发布，真实宿主验证由用户继续。GitHub issue/PR 和 commit message 使用英文，提交保留配置作者并附 Codex trailer。
