---
type: Task
title: Antigravity 代理隔离验证与 Harness 专题
description: 验证 Gateway Bot Context 的 Provider 代理，并补充全部内置 Harness 的安装和 Gateway 样例。
tags: [documentation, adapter, channel, envs, testing]
timestamp: 2026-11-01T00:00:00Z
---

# 目标与授权

对应 Issue #252 / Loop ORT-78。用户确认非 TUN，要求先通过 Channel Gateway 配置 envs 验证，再为每个 Harness 补充安装、Gateway 样例和代理说明，并明确“开始测试验证 然后实施”。随后用户确认以文档交付本轮需求，授权本地 CI、code-review、更新代码、提交、推送及创建 PR；不包含合并或扩大 GitHub CI。

真实模型验证基线为 `85411725`；PR 交付已快进到最新 main `3f2a810b61fefeafa6ad1571f68362b73494b85a`。独立 worktree `octo-runtime-ort-78`，分支 `triage/ort-78-antigravity`。此前 main@49f9b11f 的全局代理诊断仅为历史证据，不当作本轮配置隔离验收。

# 产品意图与责任

- 宿主选择每个 Bot 的 Harness、环境变量和审批策略，准备安装与账号认证。
- Gateway 将 Bot Context 装配为每轮显式输入；Adapter 只向本轮 Provider 子进程注入环境，不改变 Extra 或其他 Bot 的全局环境。
- 文档说明当前已有机制，不新增代理开关、网络路由策略、环境自动发现、能力目录或 Provider 自动安装。
- 非 TUN 不等于系统代理关闭。进程环境隔离不能当作操作系统路由或严格直连保证。
- OpenClaw 连接独立 Gateway，拒绝非空逐轮 envs；不将子进程方案推广至它。

# 范围与验收

1. 使用真实 Bot 配置校验和 Gateway dispatcher，经过独立 Kernel 与真实 agy，返回预期文本及唯一成功终态；宿主代理变量前后为空，确认清理。
2. 完整 IM 收发需有效 QA Bot 凭据、专用群和真实结果回读。缺凭据写 BLOCKED，不伪装通过，不因此阻止独立配置链路验证与文档说明。
3. 14 个默认 manifest Harness 均有中英文独立专题：安装/认证、原生检查、Gateway config、代理应用边界及特殊限制。mcode 对应 MiniMax Code，不是用户要求排除的小米 mimocode。通用 ACP 是工厂，链接作者指南，不冒充内置 Harness。
4. 统一 Gateway 代理页提供完整声明、env_variables 列表、导入/重载步骤、全局继承和系统代理边界，明确 OpenClaw 例外。
5. 文档命令和双语 JSON 对等、链接可解析、Bot 配置和 Context 满足当前校验。保留原 Codex Computer Use 与 CodeBuddy 额度说明。
6. 不修改运行行为、依赖、workflow、job、触发条件、矩阵、必需状态或默认测试开关。检查只本地显式执行。

# 可执行性

规格可执行性 96/100。差距 4 分：完整 IM 回读的现有 QA 凭据无效，需用户在受保护文件中更新；不影响文档范围与已明确配置合同。其他 Harness 的新版本代理可用性没有逐个实测，不属于本轮成功声明。
