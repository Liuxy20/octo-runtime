---
type: Reference
title: ImSessionStore 的用途与 Electron SQLite 接入
description: 说明 Gateway 保存哪些会话状态、宿主如何实现存储，以及默认内存和宿主持久化的收益与边界。
tags: [extra, channel, session, reset, storage]
---

# ImSessionStore 用来做什么

`ImSessionStore` 是 Channel Gateway 读写 IM 会话状态的接口。它帮助 Gateway 回答：“这个 Bot 在这个群、私聊或话题里，应该继续哪个逻辑会话和哪个 Provider 会话？”Gateway 负责决定何时读写；接口的实现决定数据保存在内存还是宿主数据库。

例如，Bot 在群 A 中已经使用逻辑会话 `S1`，对应 Codex 原生会话 `P1`。下次群 A 的合法消息到达时，Gateway 从 store 读取这组绑定，再向执行层明确提交 `S1/P1`。群 B 使用另一组 key 和绑定。执行层消费 Gateway 提供的身份，不自行查询 IM 数据库。

当前源码接口见 [session-store.ts](../../../packages/octo-runtime-extra-channel-gateway/src/application/session-store.ts)。`createSessionStore` 工厂已接到真实 Gateway/Manager；业务类型从 `/extras/channel-gateway` 公开。完整方法语义、宿主装配示意及可运行无数据库样例见 [SDK 指南](../../../SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)。源码消费方在能力合入后更新最新 main；真实 Electron/SQLite/Provider 联验由宿主执行。

## 保存的数据

| 数据 | 当前字段或内容 | 用途 |
| --- | --- | --- |
| 会话绑定 | 逻辑 session ID、Provider session、generation、最近 Run/Event ID | 下一轮续聊；reset 后区分新旧代次，阻止旧执行覆盖当前绑定 |
| 输入准备状态 | initialContextPrepared、gap、rulesContext | 记录首次历史准备、待补聊天位置及群/话题规则版本状态，供既有输入准备策略使用 |
| 消息处理记录 occurrence | 文本、session/Run ID、可选请求快照和尝试记录 | 识别已处理消息，并为既有卡片重试保留本轮输入 |
| reset 去重记录 | 聊天 key 与 reset 控制消息 ID | 避免重复收到同一条 reset 时反复增加 generation |

Provider session ID 是恢复标识，完整 Provider 对话仍由 Provider 自己管理。store 不承担完整聊天记录、完整执行事件或可靠投递账本的保存。历史缺口与规则状态是准备进度，不代表模型已阅读或遵守材料。

**接口中包含文本和可选请求快照。** 如果宿主将 occurrence 完整写入 SQLite，文本及快照也会落盘，不能将其描述成“只存几个 ID”。宿主负责适当的保留期限、容量、访问保护和账号隔离，不应因接入这个接口而无限保存消息和 Context。

## dependencies 为什么需要存在

`dependencies` 是宿主提供给 Extra 的业务能力容器，已经用于注入 `loadContexts`；本任务新增的是其中可选的 `createSessionStore`。它把可序列化配置与宿主函数、资源分开：

| 输入 | 谁提供 | Gateway 如何使用 |
| --- | --- | --- |
| config | 宿主 | 读取 Bot、模型、接口地址及宿主 scope 等 JSON 值 |
| dependencies.loadContexts | 宿主函数，可选 | 每轮读取当前业务提示词和 Context |
| dependencies.createSessionStore | 宿主函数，可选，待接通 | 每个有效且启用的 Bot 创建独立的会话存储句柄 |

`loadContexts` 决定本轮给模型什么材料；`createSessionStore` 决定 Gateway 将会话状态读写到哪里。两个函数职责不同，配置其中一个不要求配置另一个。工厂返回的对象实现 `read/save/reset/occurrence/remember` 及其支持的可选方法，不需要继承某个 SDK SQLite 类。

## Electron 使用自己的 SQLite

整个 `octo-runtime` 不依赖 SQLite，也不提供 SQLite 适配实现、表结构或迁移。SQLite 是宿主的选择，Electron 宿主自行实现 `ImSessionStore`；Gateway 只认识接口，不识别底层数据库。库内新增样例和测试采用不依赖 SQLite 的宿主 store 替身，真实 SQLite 落盘恢复在宿主仓库验收。实现的装配与关闭顺序为：

1. Electron 主进程打开宿主数据库，完成自己的迁移、登录及组织/助理 scope 配置。
2. 主进程原生构造 `createExtraService`，在 dependencies 中提供 `createSessionStore(botConfig)`。工厂按可信配置选择存储范围，返回一个实现 `ImSessionStore` 的独立句柄；多个句柄可以使用同一个宿主数据库连接。
3. Gateway 通过返回句柄读写会话状态。函数和句柄留在宿主进程，不经过 renderer、JSON 配置或 Kernel IPC；SQLite 的表名、驱动及加密方式由宿主决定。
4. 退出、切账号或重载时，宿主先等待旧 Extra 关闭及其收尾结果。Gateway 释放自己持有的句柄；只有确认依赖该连接的使用者均已完成后，宿主才关闭共享数据库。清理超时须保留失败并处理尚未结束的资源，不能直接重建同名实例。

这里“关闭句柄”表示该 Bot 不再使用存储，不表示执行整个 SQLite 连接的 `close()`。数据库还能被应用其他功能使用。切账号要使用新账号的 scope，不能复用旧账号的存储范围；scope 不能从入站消息正文或路由字段推断。

工厂和常规存储方法沿用同步合同，句柄释放允许异步。宿主需要提供满足同步读写合同的适配实现；不能直接把 Promise 返回值当作合法 store。同步 SQLite 查询会占用主进程执行时间，SDK 不会自动把它放到线程或使查询非阻塞。

## 相比默认内存有什么收益

| 方面 | 默认 MemoryImSessionStore | 宿主 SQLite 实现 |
| --- | --- | --- |
| 接入成本 | 不用提供存储，开箱即用 | 宿主实现接口并维护数据库 |
| 重启或卸载重载 | 内存清空后失去原会话绑定，后续可能创建新会话 | 已提交的数据可以重新读取，尝试续接原逻辑及 Provider 会话 |
| 账号、组织和助理隔离 | 每个内存实例内使用当前绑定 | 宿主可以按自己的账号/组织/助理模型分区，跨重启保留归属 |
| 数据管理 | Runtime 按既有数量、字节和 TTL 边界保留 | 宿主统一管理数据库、访问保护、保留和清理策略 |
| 对执行内核的要求 | 不需要业务数据库 | 同样不需要业务数据库，内核保持通用 |

核心收益是**应用重新打开后，还知道原来应续接哪个会话**，而不是仅在进程存活时记得这个关系。宿主也不需要让 Runtime 另建一套数据库，可以复用已有存储管理。

收益成立的条件是宿主确实保存并提交所需状态，重新加载时使用相同可信 scope，并且 Provider 的原生会话仍可恢复。持久 binding 不能恢复进程退出时尚未结束的 Run，也不保证 Provider thread 永不变化、reset 后没有历史或消息恰好处理一次；恢复失败继续使用既有显式恢复策略。

## CLI 的默认行为

当前 CLI 调用 `createExtraService` 时传入 `dependencies: {}`，见 [main.ts](../../../apps/cli/src/main.ts)。Gateway 因未注入 sessions 而创建 `MemoryImSessionStore`。本任务保留这个默认：CLI 不会因为支持宿主工厂就自动创建 SQLite 文件。

因此，不需要跨重启恢复绑定的宿主可以继续默认内存；需要持久恢复的 Electron/Buddy 宿主选择自己的存储实现。后续若 CLI 要持久化，也应由 CLI 作为宿主明确提供工厂及数据管理策略。
