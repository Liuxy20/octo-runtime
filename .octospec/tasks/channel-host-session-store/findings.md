---
type: Reference
title: 宿主存储现状与旧 PR 复用依据
description: 固定 main 和 PR 65 的源码事实，区分现有实现、历史验证及待实施内容。
tags: [architecture, extra, lifecycle, session, storage]
---

# 固定来源

本文记录规划基线事实，后续修复与验证见[实施记录](implementation.md)；下述基线缺口不表示修复后仍缺失。

2026-10-21 读取 GitHub #57/#66 正文及评论、#65 元数据和源代码。#57/#66 均 open，#65 open、未合并。新 worktree 的 HEAD 等于 fetch 后的 `origin/main@0c1d1c9`；PR 以本地只读 ref `origin/pr-65@0c50ea9` 核对，未 cherry-pick 或 merge。

## main 的真实缺口

| 文件 | 当前事实 | 实施含义 |
| --- | --- | --- |
| `public/channel-gateway.ts` | 已有模块入口，`GatewayDependencies` 只是共享 `ChannelDependencies` 的别名 | 改为 Gateway 自有依赖类型并公开存储相关类型，不必新增 subpath |
| `public/extra.ts` | 当前没有 Gateway 存储专属导出 | 不移入 #65 的重复导出，不扩大通用门面 |
| `src/extra.ts`（Gateway） | initializer 只接 `ChannelDependencies`，Manager 装配没有工厂 | 接通真正业务依赖，保持两阶段入口 |
| `src/lifecycle/manager.ts`（Gateway） | 已深拷贝配置并串行 upsert；只登记 Runtime，没有工厂句柄记录 | 增加先登记后初始化、回滚与失败保留的所有权管理 |
| `src/application/im-channel.ts`（Gateway） | `sessions ?? new MemoryImSessionStore()`；注入 sessions 时不 close | 工厂路径经受控视图注入；保留直接借用行为 |
| `src/application/session-store.ts`（Gateway） | 必需方法同步，`close` 当前声明 void；已有 gap 和规则原子方法 | 允许异步释放并完整公开合同类型，不能遗漏新规则能力 |
| `packages/octo-runtime-host-sdk/src/extra-service.ts` | 同进程依赖快照、停止准入、Run 排空、disposer、共享截止及失败名称占有 | 复用当前机制；返回对象的方法不自动经过顶层函数包装，Gateway 必须自行约束句柄访问 |
| `packages/octo-runtime-host-sdk/src/shutdown.ts` | 4 秒单调期限、父 signal 继承和有界等待 | 工厂句柄清理使用同一个截止，不能逐 Bot 或逐层重新计时 |

上表 Gateway 文件路径均相对于 `packages/octo-runtime-extra-channel-gateway/`。

## #65 的复用与改写

| 部分 | 决定 | 原因 |
| --- | --- | --- |
| Gateway 专属工厂、独立配置快照、句柄借用/拥有区分 | 复用设计，迁移到当前 host-sdk | #57 的核心需求仍未进入 main |
| `HostSessionStore` 访问保护、释放幂等、draining 错误保留 | 复用思路后补齐 | 旧版本只转发 `patchGap`，没有当前规则失效/patch 方法 |
| Manager endpoint 记录、启动失败回收、失败阻止替换 | 适配当前 manager 和共享 shutdown helper | 不能复制旧 5 秒分层 timer 或丢失父 signal 截止 |
| SQLite 恢复、scope、reset、无效工厂和所有权回归 | 复用场景断言；库内改为无 SQLite 依赖的宿主 store 替身，SQLite 重开在宿主仓库验收 | 旧测试使用已删除的 daemon 和执行端口；旧通过数量不是新基线证据 |
| `LocalExtras` / `run-stream` 特殊执行适配 | 不移植 | #73 已统一 KernelClient，#72 已实现 Gateway drain，#74 已删除旧服务装配 |
| `/extra` 的 Gateway 类型重复导出 | 不引入 | #66 要求业务入口承载业务类型，当前 main 已没有这些重复项 |
| `package.json` 新 Gateway subpath 与 verifier 精确清单 | 核对现有清单后仅补实际缺口 | main 已有三个内置 Extra 入口，不重复添加 |

## 已有生命周期证据入口

以下仅说明现有源码/测试覆盖的目标，本轮未运行产品测试：

- `test/kernel-invoke.test.js`、`test/kernel-invoke-lifecycle.test.js`：caller abort 尾流、控制错误、owner 排空、观察关闭与调用隔离。
- `test/gateway-shutdown-drain.test.js`：Gateway 的尾绑定、终态后展示/投递、保存错误及迟到工作。
- `test/gateway-runner-drain.test.js`：实际 Kernel 与原生 Extra 服务联合收尾、兄弟 Run 保持；文件名 runner 不表示当前还存在旧部署合同。
- `test/extra-service-shutdown.test.js`：宿主 SQLite disposer 写入、真实异步依赖占额、初始化回滚及共同期限。
- `test/extra-dependency-container.test.js`：类实例和继承方法的接收者及权限包装。

## 发布与兼容边界

2026-10-21 查询官方 npm registry：`latest=1.0.1`，已有 `0.0.0-stage`、`1.0.0-rc1`、`1.0.0`、`1.0.1`。GitHub `v1.0.2` 为 draft；不能当作已发布。

源码 tag `v1.0.1:public/extra.ts` 不含 #65 新增的 `GatewayDependencies/ImSessionStore/ImSessionBinding/ImSessionOccurrence` 重复导出，包含历史共享 `ChannelDependencies/LoadContexts`。本次不删除这些已存在共享名称，也不把整理整个门面列入范围。尚未逐一解包所有历史 prerelease 产物，因此不宣称所有历史版本都已审计；实现阶段以实际 tgz 核对将受影响的名称。若发现确实发布过需要删除的业务名称，先给出弃用/版本策略；当前只需不引入旧 PR 的重复项。

`SDK_CHANNEL_GATEWAY_GUIDE.md` 当前停止章节仍提到 `extra.stop()` 和 runner；与原生服务 `close()` 不一致，应在交付存储示例时一并校正。规则中的旧“只使用 Memory/不新增绑定持久化”必须明确为 Runtime 默认不建库；宿主显式工厂不等于 Runtime 接管数据库。该说明在实现完成后回写，不提前把计划写成当前能力。
