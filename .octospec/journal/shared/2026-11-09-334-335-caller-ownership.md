---
type: Journal
title: 应用提示词与工作目录回归调用方
description: 删除 Runtime 注入和目录分配抽象，记录跨包验证及外部消费者限制。
tags: [architecture, protocol, workspace, validation]
---

# 当前结论

Issue 334 删除 octo.control/instructions、controlInstructions、拼装/首轮注入 helper 和 Adapter 专属指令载体。应用先按自身顺序构造完整普通 inputs；Runtime 不从执行设置或业务 namespace 补文本。

Issue 335 删除 workspace.mode、workspace_mode 及无消费者的随机分配器和导出。Agent Run 前业务方已创建目录；CLI/SDK 显式传路径，Core 启动 Provider 前只校验。缺目录返回 WORKDIR_NOT_FOUND，其他缺失/非法/非目录/不可访问分别保留稳定原因码。续接失去目录仍失败，不创建、不换目录；OpenClaw 等自管工作区保留无本地覆盖。

两个方案均先达到 96/100 并通过实施前双轴审查；生产里程碑为 `7a76a454` 与 `b645a474`，最终整改 `df754e94`。整改后 1548 全量通过/61 条件跳过、55 显式专项、11 client 包外与完整 Runtime 包外通过；真实 Codex0.164.0/Claude2.1.306 简单文本两种输出视图在此前实施树通过。详细事实与未验范围见 [联合验收](../../tasks/334-caller-owned-prompts/validation.md)。

用户取消 Gateway #23，Work App 不涉及；Gateway 仍依赖旧提示词和 mode 合同，审计不是迁移完成。源码/协议版本未机械升级，不发布 npm，不改 CI 范围；正式 PR/main 状态需以远端实际事实补记。
