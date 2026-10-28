---
type: Task
title: Issue 222 DSH 最低版本检查
description: 将 DSH 精确版本准入改为最低版本要求并提供升级提示。
tags: [adapter, testing, installation]
---

# Issue 222：DSH 最低版本检查

依据：[Issue #222](https://github.com/Mininglamp-OSS/octo-runtime/issues/222) 及用户 2026-10-28 的明确决定。独立 worktree 从 `origin/main@0ca12a0` 创建，分支 `fix/issue-222-dsh-min-version`。

## 目标与责任

业务目标是避免 stdio Adapter 因 Provider 版本变化直接拒绝执行。宿主选择、安装和升级 DSH；Adapter 对宿主显式 `dshBin` 执行 SemVer 最低版本检查，继续使用未修改的官方 SDK 转换真实最终消息。用户接受未来版本的兼容风险，要求 `DSH >= 0.2.1-rc.4`，不设置版本上限。

合同内动作：版本探测、初始化结构校验、原生轨迹到 canonical final 的转换、真实失败传播与已有进程清理。不得自行安装、切换 Provider、重建 Home/会话或改变其他 Adapter 的准入策略。CLI、Kernel、进程内 SDK 共用同一个 DSH Adapter 合同，服务拓扑和公开输入保持。

## 实施与验收

1. 使用 SemVer 库按版本优先级比较；最低版本、后续 RC、正式版及更高版本均允许，包括更高版本的预发布；build metadata 不改变优先级。旧版本和不可解析版本明确失败。
2. 保留 `DSH_VERSION_UNSUPPORTED` / `OH-ADP-3005`，提供检测版本、最低版本及升级提示；非法版本输出不直接回显任意 stdout。probe 返回实际检测版本，原有 `DSH_VERSION` 导出作为最低版本别名保留。
3. 初始化保留真实服务名称及响应结构校验，移除 `serverInfo.version === "0.0.1"` 精确限制；非法响应使用 `DSH_PROTOCOL_ERROR`，不误报为需要升级。
4. 验证最低/高版本均能转换最终消息、返回唯一终态，旧版本在发送 prompt 前拒绝；Core/Kernel 调用保留升级提示。原有执行、续聊、错误及清理回归保持。
5. 同步双语 README、显式原生验证及其报告，记录离线与真实验收的范围。官方 Client 依赖继续固定 `0.2.1-rc.3`，本任务只改变外部 DSH Provider 的接受范围。
6. 不扩大 GitHub CI：不新增 workflow/job/矩阵/步骤/自动开关或必需检查；专项在本地显式运行。交付前核对 `.github/workflows` diff。

## 授权范围

实施阶段授权实现、测试和 octospec 记录；用户随后明确授权按 code-review 双轴审查并自动修复，有效问题解决、复验通过后提交、推送并创建英文 PR。不得扩大 CI 范围或自动合并。
