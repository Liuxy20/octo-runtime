---
type: Task
title: Issue 40：OpenClaw 7.1 至当前稳定版兼容
description: 记录 Gateway 合同适配、权限回退及已实现和待真实验收的范围。
tags: [openclaw, adapter, invocation, interaction, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 目标与状态

针对 [Issue #40](https://github.com/Mininglamp-OSS/octo-runtime/issues/40)，用户补充当前实测只有 `2026.9.1` 生效、`2026.7.1` 不生效，要求覆盖 7.1 至今的版本。兼容实现、27 标签严格请求投影、真实 6.11 与 9.4 代表验证已落实。用户明确接受现有结果为本次合并验收，并授权提交 commit、创建 PR 和合入 main；当前进入交付检查。真实全矩阵未执行项保留为后续覆盖，不改写为通过。实际进度以[实施记录](implementation.md)为准。

独立 worktree：`octo-runtime-issue-40`；分支：`research/40-openclaw-compatibility`。创建前已 fetch，基线为 `origin/main@88fa71db6f32c7898bfcc05d40eb2a44fd91d141`。截至 2026-10-22，官方最新稳定 Release 为 `v2026.10.5`；`v2026.10.10-beta.*` 不纳入稳定版支持承诺。

交付：[原因与证据](analysis.md)、[版本矩阵](compatibility-matrix.md)、[整体方案](design.md)、[权限降级与细化实施计划](implementation-plan.md)、[实施与验证](implementation.md)、[实际读取记录](context.yaml)。

## 已确认的整体目标与判定方式

整体目标是兼容 OpenClaw `2026.7.1` 至当前稳定版，覆盖会话创建、执行、流式输出、审批、取消、终态和资源回收。原 26 个标签及追加实测的 6.11 共 27 个标签是本轮证据基线，不是将支持范围永久限定为这些标签；后续稳定版继续按实际合同补充验证。

在 OpenClaw Adapter 内，根据 probe 获得的真实握手协议号、`server.version`、方法和事件集合，结合已验证的版本合同进行兼容判定。同为协议 v4 仍可能存在字段和行为差异；协议号、版本号或方法名任一项都不能单独证明完整兼容。

probe 与实际 invocation 共用合同解析器。probe 只执行连接和只读检查；实际执行在每次新连接或重连后重新核对握手，再选择参数及生命周期映射，避免 probe 后 Gateway 升级或切换造成过期判定。调用方继续使用统一 Runtime 接口，版本分支由 Adapter 内部处理。

用户进一步明确：权限是业务口径，主要为 full_access 和提醒／审批两类；兼容回退方向是“权限往大了降”，即 ask 在目标版本／实例不可用时直接采用 full_access，无需逐次确认，并说明实际采用方式。ask 可用时仍保持 ask，不要求旧版复制新版 guarded 文件边界。具体 reviewer／harness 的处理仍需验证，完成目标包含旧版真实调用及回退验收，不能用明确拒绝代替旧版可用。

## 产品意图与关键合同

| 项目           | 责任及约束                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 业务目标       | 同一个 Runtime 调用入口可以执行宿主选定的旧版及新版 OpenClaw                                                                     |
| 宿主决定       | Provider、目标 Agent、连接配置、审批意图及安装升级                                                                               |
| Adapter 决定   | 按实际 Gateway 合同编码参数、处理事件、审批和取消，并报告真实结果                                                                |
| 显式输入       | 现有 InvokeInput/InvokeRequest、approvalMode、model、effort、controlInstructions                                                 |
| 越界动作       | Channel 添加版本分支、要求调用方拼 Provider 私有参数、自动升级 Gateway、修改全局工具策略；本任务允许有提示的 ask→full 会话级回退 |
| 对其他产品影响 | CLI 与原生 SDK 共用 Adapter 修复；不新增公共能力目录，不改变 Run=7、Context=v3、IPC v1                                           |

权限参数不兼容时先按业务意图映射，ask 不可用则采用已授权的 full 回退，并说明实际采用方式；不能仅删除字段后声称原模式完整应用。ask 回退 full 时同步调整审批桥，避免仍按原始 ask 等待人工。新会话的创建、执行接纳、执行终态和资源回收分别确认。协议 v4 和方法名不足以证明字段或行为兼容。

执行拓扑维持 Host/Extra → Kernel → worker 内 AgentExecutor → OpenClaw Adapter → 已有 Gateway。Adapter 拥有每次 invocation 的 WebSocket 和所属订阅/Run 控制；OpenClaw 拥有 Agent 原生工作区和策略。本任务不增加进程、不改变服务装配及资源所有权。

## 本轮验收

- 已读取 issue、最新 Adapter、测试和命中规则，定位失败参数的产生位置。
- 已逐标签核对 27 个非 beta 标签的创建请求 Schema、主调用字段和协议版本；矩阵区分源码核对、本地 Schema 验证、用户反馈和真实联调。
- 已对 7.1 原始创建 Schema 完成本地 TypeBox 校验，证明三个独立的未知字段失败。
- 已实现 Adapter 内版本合同、两类业务权限及回退、共享有效审批策略、终态及取消对账，并生成 27 标签严格请求投影与 54 条逐模式流程测试。
- 真实 Gateway 9.4 的 full_access／ask 固定文本和接纳后取消验证通过，未调用工具或 IM；诊断 ID 对应的实际服务端版本和完整 trace 未取得，不将用户反馈视为本轮独立实测。
- 用户批准配对后，真实 6.11 的只读 probe、两类权限文本、固定工具及取消五场景通过，ask 明确回退 full_access。用户确认这些代表结果满足本次合并验收，授权按仓库保护规则交付；实际内网地址及凭据脱敏。

## 范围外

不变更用户 Home/凭据/Agent/工作区。beta、第三方 fork 及未列出的 6.x 版本不承诺自动兼容。提交、推送、创建 PR 和合并已获本轮明确授权；GitHub 必需检查和评审仍须满足。所有真实版本全面实测的长期目标与本次代表验收分开记录，不能用明确报错代替旧版本支持完成。
