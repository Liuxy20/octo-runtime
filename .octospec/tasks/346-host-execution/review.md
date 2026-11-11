---
type: Review
title: Issue 346：双轴代码审查
description: 记录 Standards 与 Spec 独立审查、问题修复及复核结果，不以规划评分代替证据。
tags: [architecture, adapter, review]
---

# 方案自审

以下为初始方案自审；后续用户授权实施与独立 code review，结果见下文。

| 检查 | 发现及处置 | 状态 |
| --- | --- | --- |
| metadata 是否足以存依赖 | 现有 metadata 是注册与输出描述，providerPath 是 probe 结果；设计禁止反向配置，改为复用工厂参数/CommandSpec/provider | 已在 design 明确 |
| 只固定 executable 是否足够 | Windows resolveProcessLaunch 仍可能选择相邻/其他 Node；增加宿主绑定 runtime + 前缀 argv，底层不再重新搜索 | 已列 M1、A04/A10 |
| probe 与执行是否同源 | OpenCode 每轮查找、Codex probe 使用默认环境；要求 probe/执行/恢复同一绑定，仍保留版本校验 | 已列 A02/A06/A07 |
| 缺安装是否导致全 CLI 停机 | 删除默认实例会使 factory 缺依赖；由 CLI 静态 metadata + defineAdapter 构造 unavailable 包装，区分配置形状错误与安装缺失 | 已列 A11/A12 |
| 强制 client-only/统一构造是否越界 | 普通命令可使用显式启动描述；Codex 专用 provider 保持，ACP 复用 factory；不推广统一 Engine 合同 | 已在 brief/design 明确 |
| 协议功能是否误删 | OPENCODE_CONFIG_CONTENT、工具 PATH、MCP、envs 继续传递；只禁止自动重选 Provider/runtime | 已列 A05/A14 |
| 是否把远程当成本地路径 | factory/provider 封装位置，本机不 stat；真实远程和任意 client 结构兼容不宣称已实现 | 已列 G1、A09 |
| 生命周期是否过度统一 | 本轮 transport 可受委托 spawn/close；共享 engine 只由 owner 最终关闭，Home 独立 | 已列 A07/A08/A13 |
| 是否遗漏独立实现 | Grok adapter/client、CodeBuddy、Claude、Antigravity、DSH/OpenClaw 单列，不只修改标准 ACP | design 逐类表覆盖 |
| 是否挟带 CI 或远端交付 | 仅文档，专项拟放 test/manual；无 workflow/default selector 修改，无提交/推送/PR | 交付时由 validation 记录实际 diff |

剩余风险及四分缺口见 [assessment](assessment.md)。上述“已明确”只表示规划已补齐，不代表相应测试已经通过。

## Standards

使用 code-review 技能的独立 reviewer，以 main@c7ae0256 加当前未提交及新增文件为范围，依据 AGENTS 与工程/架构/环境/本地执行/生命周期规则审查。当前 0 项未关闭 finding，无需单列的代码异味。

已修复 POSIX Electron 错误优先搜索 cwd/node、读取 shebang 误拒绝 execute-only 原生程序、无扩展名 Node 入口随请求 PATH 换运行器，以及 Node 前缀入口损坏时 probe 假可用。独立执行相关 3 项专项、模拟 Electron PATH 分支和 diff/CI 核对通过。复杂 Node shebang 参数要求显式注入，避免丢失参数。Windows/Electron 实机未验。

## Spec

另一独立 reviewer 依据 brief/design/plan 及用户“无兼容层、CLI 发现 executable”指令审查。当前 0 项未关闭 finding。

已修复 unavailable Adapter 的拒绝 iterator 导致 Core 清理永久 incomplete（P1），以及 ask/native 提前误报审批能力不足（P2）。采用 async generator 和 runAdapterPreparation 确认无 Provider 资源，responder 只拒绝无活动请求。Core 四种受支持协议/审批组合均报告依赖失败且 cleanup complete。

失败目标、ENOENT/EACCES 分类、启动链与探针同源问题、helper 子路径和 live fixture 重复导入均已修复。Reviewer 独立重跑 #346 的 12 项全部通过，并检查两份 live fixture 语法。metadata/schema、单 owner 生命周期及 CI 范围符合约定。

真实 OpenCode ACP 另暴露并修复基线 diagnostic severity 与协议不符；专项 assertCanonicalEvent 和真实重跑通过。当前 Standards 0、Spec 0，两轴无未关闭的最高严重问题；最终检查和真实环境边界见 [validation](validation.md)。

## PR #347 追加反馈

以上为提交 e657ac0c 的交付前审查，存在漏检，不代表远端审查已批准。2026-11-10 用户要求修复 CI，并提供两条 P1 与一条 P2 review；Windows 既有测试另有失败。

- P1：通用 probe 误把可选版本失败作为不可用。恢复 executable 可用与版本未知的区分，不推测 Node 前缀参数，也不回退安装。新增显式手动 ACP/Core 回归覆盖版本非零退出和超时后协议执行成功；E2BIG 等实际 spawn 系统错误仍报告不可用。
- P1：OpenCode received-config 缺失。修复前本机复现版本探测在 2 秒超时导致尚未执行 transport；相关 Core 用例单独重跑通过，没有证据表明 stdin end/close 本身失效。fixture 宿主显式绑定 Node/入口，并增加具体 OPENCODE_INCOMPLETE_OUTPUT 断言；现有文件回读与 cleanup 断言继续验证输入结束和退出。
- P2：actmode live 入口仍引用已删除的默认导出。改为复用 CLI 宿主工厂，并在 Executor 关闭后关闭 Codex owner；手动离线 startup 检查验证缺安装时仍完成装配与回收。
- Windows CI：混合大小写环境测试先调用宿主 resolveHostProviderLaunch，再向 probe 传入固定绝对路径；保留原场景和检查范围。

本轮复核与 CI 的实际结果以 validation 追加记录为准，不将旧 review 的零 finding 继续作为本轮结论。

用户随后明确 OpenCode 升级不应影响 octo-runtime，取代初始保留版本范围的方案。删除最低/主版本范围与未知版本拒绝、invoke 前的版本探测，以及已过时的 V1 拒绝验收脚本；双语指南同步。现有版本用例改为新旧版本、预发布和未知版本均能执行 JSON/ACP，并检查实际 invoke 没有额外调用 --version。该原则不影响真实协议失败和资源回收结果的报告。

本轮最终 Standards 0、Spec 0。Standards 独立验证 12 项相关用例，Spec 复核两路 launch/版本/清理及文档。撤销前轮“版本失败一律不可用”的判断；Windows helper 补 cwd 符合参数合同，但绝对 PATH 下未传 cwd 并未复现故障，不计为新增 P1。真实 Windows 由既有远端矩阵验证，未宣称本机已验。
