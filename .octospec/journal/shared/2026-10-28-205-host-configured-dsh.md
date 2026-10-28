---
type: Journal
title: Issue 205 宿主管理 DSH npm 入口交付记录
description: 记录 CLI 宿主发现、Adapter 显式配置和评审修复的实施事实。
tags: [adapter, runtime, testing]
---

# Issue 205：宿主管理 DSH npm 入口

2026-10-28 按 Issue #205 评论实施：宿主维护并传入绝对路径 `providerOptions.dshBin`，删除 Adapter 内的 PATH、command/args、Desktop/ASAR 发现与桥接。官方 SDK 保持未修改；Kernel 原有配置链路同时服务 discovery 与 invocation，Electron 子进程固定 Node mode。

PR #219 首版遗漏 CLI 自身的自动解析。按用户指出的问题，补齐 apps/cli 宿主配置层：显式 profile dshBin 优先，否则从首个 PATH dsh 的 npm 元数据解析入口；常驻 Kernel 与 playboard 共用并传入同一配置，不执行 Windows shim、不换另一安装。新增 CLI 集成回归及三平台真实 npm shim 解析验证，SDK 不继承 CLI 选择策略。

后续 review 的元数据 return 后继续循环判断不成立，但暴露了 access/stat 之前的候选边界：损坏链接、不可执行文件及目录此前会被跳过。现以 lstat 区分不存在与已存在但不可用，只有不存在才扫描下一候选；三类问题均有修复前失败、修复后通过的执行证据，元数据错误与缺失路径的正反例同步扩充。

方案、责任与验收见[任务简报](../../tasks/205-host-configured-dsh/brief.md)，实际命令、测试范围、已修正评审项及上游 Electron 39 原生兼容限制见[验证记录](../../tasks/205-host-configured-dsh/validation.md)。不重置宿主或 Provider 身份、配置、认证和已有会话。跨平台 fixture 与原生结果分别记录，不以 Node 或 macOS 成功替代 Windows/Linux 验收。

同步 `main@4264fd7` 时，仅任务索引与 #217 CodeBuddy 条目发生文本冲突，保留两项；Adapter 规则自动合并后两边合同均保留。CLI 及依赖构建通过，DSH/CLI/Windows 和 CodeBuddy 模型/结果回归共 94 项通过、4 项按平台跳过。文档检查发现本任务四份记录缺少 YAML 头，补齐元信息后重新校验。

用户要求撤除新增 GitHub CI，并设为全局架构约束。删除 DSH/Electron 三平台 job 和 CI Gate 对其依赖，workflow 恢复目标分支原样；此前 workflow 改动额外触发的两项 Workflow Sanity 检查也随之不再触发。专项脚本仅保留手动入口，历史验证不作为持续 CI 承诺。全局 Agent 指令与仓库架构规则同时记录严禁擅自扩大 CI 范围。

撤除 CI 后，run 40639444839 的 Ubuntu Node 24/26 与 macOS Node 26 均在同一条发行测试断言失败：测试仍要求已删除的 verify-dsh 依赖。本地定向复现后，将该断言恢复为目标分支原有的 check、verify-windows-release 两项依赖，并删除对应 DSH_RESULT 断言；不修改 workflow 或执行实现。release-latest、windows-release-verifier、release-process 三份测试共 33 项通过，无跳过；格式、OKF 与 diff 检查通过，workflow 和发行断言均与目标分支一致。

用户要求完整本地验证后，运行 `pnpm test` 重新构建 workspace 并执行全部 UI/Node 测试：UI 35 项通过，Node 2,136 项通过、58 项条件跳过、0 失败。另运行完整 `pnpm lint`、`pnpm lint:names`、`pnpm format:check`，均通过。完整测试日志为本机 `/tmp/octo-runtime-219-local-full-test.log`；本地 macOS 结果不替代远端平台结果。

最新 review 在 `be855d5` 指出公共 runCli 的 playboard 分支漏传 env，直接 runPlayboard 测试未覆盖该边界。新增两个独立 fake 安装的 PATH 分歧回归，修复前确认误选进程安装并返回 DSH_VERSION_UNSUPPORTED，再由 CLI 显式转发 dependencies.env，修复后完成执行。完整 pnpm test 再次通过：UI 35 项、Node 2,137 项通过、58 项条件跳过、0 失败；类型、lint、命名、格式、文档及 OKF 检查通过。validation 区分各历史阶段与当前基线，已核实基线 CI run 40640404210 成功；新修复仍按新提交独立核验，不扩大 CI 范围。
