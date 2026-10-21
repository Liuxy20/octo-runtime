---
type: Journal
title: Gateway 宿主会话存储规划
description: 从最新 main 创建 feat worktree，对齐 Issue 57、PR 65 和 Issue 66 的当前实现边界。
tags: [architecture, extra, lifecycle, channel, session, storage]
---

# 本轮结果

2026-10-21 拉取 `origin/main`，从 `0c1d1c99c90a85c715212de6e55858a41924f058` 创建 `feat/channel-host-session-store`，目录 `octo-runtime-channel-host-session-store`。Codex 管理 worktree 工具因当前聊天位于多仓父目录返回 `Not a git repository`，因此在实际 `octo-runtime` 仓库内使用 Git 原生命令创建。

读取 #57、#65、#66，固定 PR head `0c50ea9` 并核对源代码；PR 未合并，未将其提交移入新分支。main 已合并 #72/#73/#74，存储缺口仍存在，执行和服务生命周期则必须复用新的原生服务及 KernelClient。

产出 [任务简报](../../tasks/channel-host-session-store/brief.md)、[现状与复用依据](../../tasks/channel-host-session-store/findings.md)、[M0-M4 实施计划](../../tasks/channel-host-session-store/plan.md)、[24 项验收矩阵](../../tasks/channel-host-session-store/acceptance.md) 和规则读取清单 `context.yaml`。重点为业务入口的专属类型、同步工厂与可异步关闭句柄、共享 4 秒截止、完整规则/gap 透传、失败不降级及不可替换。

官方 npm latest 为 1.0.1，GitHub v1.0.2 仍 draft。检查 v1.0.1 源码门面未发现 #65 新增的存储重复导出；未逐一解包全部历史 prerelease，不声称完成所有发行物审计。

## 验证与边界

用户进一步要求解释存储用途、Electron 自有 SQLite 接法及收益。补充 [用途与接入说明](../../tasks/channel-host-session-store/session-store-explained.md)，区分三类存储记录、输入准备状态和完整聊天历史，明确 occurrence 可能保存文本和请求快照；说明 CLI 默认内存、宿主工厂适配、逐 Bot 句柄与共享数据库所有权，以及重启续聊的条件和代价。同步简报、计划和 A21 文档验收，仍未修改产品代码。

随后按用户要求刷新根目录 [Gateway 指南](../../../SDK_CHANNEL_GATEWAY_GUIDE.md#自定义会话存储)和 [原生 SDK 指南](../../../SDK_NATIVE_INTEGRATION_FULL_GUIDE.md#0-源码接入使用最新-main)：补充宿主存储工厂的目标加载示例、`/extras/channel-gateway` 专属类型与通用 `/extra` 的边界，校正旧 stop/runner 说明。submodule 明确跟踪最新远端 main，新增与已有子仓的命令均不依赖功能分支；宿主仍记录验收后的 commit 供 CI 复现。工厂示例保留待实现标记，不能以文档更新宣称 main 已支持。

- 修改前 OKF 检查通过：273 个 OKF 单元、20 条规则、1726 个本地文件链接。
- 刷新 SDK 指南后 OKF 检查通过：279 个 OKF 单元、20 条规则、1754 个本地文件链接；`git diff --check` 通过，新增文件另用 `--no-index --check` 检查。目标存储工厂尚未实现，未将其文档示例编译结果记作通过。
- 本轮仅规划，无产品代码改动；未运行产品构建、产品测试、真实 IM/Provider 或 Buddy 联验。
- 未创建提交、推送、PR 或发布。后续 GitHub 内容与 commit message 使用英文，提交遵循用户授权与 Codex attribution 要求。

## 验收可执行性复核

按用户要求将 24 项验收逐项映射实现/测试入口，新增[可执行性评估](../../tasks/channel-host-session-store/executability.md)与[文档独立验收 D01–D10](../../tasks/channel-host-session-store/documentation.md)。修正初始化超时不保证实际释放、可选 close 计次、同 Bot scope 验证方式和真实 drain 可达场景；主分支接入与真实宿主验收单列。现有 SDK SQLite 片段是宿主示意，不能算可运行样例；后续库内提供无数据库依赖的完整加载 fixture。

用户进一步明确整个 octo-runtime 不依赖 SQLite。已同步简报、计划、验收及根目录两篇 SDK 指南：Runtime 只消费 ImSessionStore，不提供 SQLite 驱动、适配实现、表结构或迁移；本任务新增库内测试采用宿主替身。SQLite 文件重开、事务、迁移及 Electron 驱动兼容性属于宿主工程；不以替身重新读取证明持久落盘。旧 PR 的 SQLite 测试仅复用场景要求，不整体迁入 Runtime。

可执行性结论为可开始库内实现，重点验证所有权/尾写/失败传播；A05/A23/A24 与 D09 仍需要宿主和真实环境证据，D07 的工厂 main 可用性在合入后验证。本轮未实现产品能力或运行产品测试。

本次复核后 OKF 检查通过：281 个知识单元、20 条规则、1766 个本地文件链接；tracked diff 与新增规划文件的 whitespace 检查通过，A01–A24 与 D01–D10 编号映射完整。核对根目录及 apps/packages 的 package.json，未声明 SQLite 包依赖。上述均为文档/静态检查，不是产品或宿主集成测试。
