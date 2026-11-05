---
type: Task
title: Issue 157：保留无法归因于 rg 的命令失败
description: 将 Codex rg 无匹配例外限定为可确认的独立命令，保留复合命令的失败事实。
tags: [adapter, canonical, protocol, testing]
---

# 目标与责任

修复 [Issue 157](https://github.com/Mininglamp-OSS/octo-runtime/issues/157)。基线为最新 `upstream/main@780cd7cd5e67e4868df895a2e74a826097f349fd`，独立 clone、分支 `fix/157-ripgrep-command-status`。首轮授权本地修复和证据交付；用户随后明确要求提交关联此 issue 的 PR，现授权 commit、push 和创建目标 main 的 PR。合并、发布及直接关闭 issue 未授权。

业务需要可信的工具轨迹。Provider 输入是整条 commandExecution 的 command、status、exitCode、aggregatedOutput；退出码不包含逐子命令执行事实，commandActions 也不是执行证明。Adapter 是第一个错误改写状态的责任模块，在此修复。宿主及各产品继续消费同一 canonical 生命周期，不增加产品策略、自动重试、命令改写或新公共字段。

## 关键合同

- `adapter`：只有明确的独立 rg、exitCode=1 且明确空输出，才可保留无匹配 completed 语义；不推断前置命令成功。
- `canonical / protocol`：保留原始 exitCode、output、工具 ID/name、stepId、事件顺序及 running → terminal 生命周期；不影响 native 载荷及 #317 服务所有权。
- `testing`：先以真实 Windows shell 结果送入实际 normalizeCodexEvent 出口记录基线，再验证修复；fake、shell/normalizer 与真实 Provider 分开。
- 使用小范围字面参数识别，不实现通用 shell 解析器。支持形态与保守拒绝范围在验证文档明确列出。

## 范围外

- 不更改 Provider 进程、服务生命周期、Core、公共协议、执行命令或重试。
- 不修改默认测试选择器、CI workflow/job/matrix/trigger/check/gate。新增专项置于 `test/manual/`；仅纠正既有链式用例的错误预期。
- 不使用其他 checkout、依赖、Home 或测试资源；不停止其他会话进程。
- 不承诺未运行的 Windows Server、POSIX shell、macOS/Linux、真实 Codex/Octo 或 Electron 验收。

## 验收

1. cmd.exe 真实前置失败后 rg 未执行，normalizer 保持 failed / exitCode=1 / 空输出；独立真实 rg 无匹配为 completed / exitCode=1。
2. 成功匹配、rg 真错误、其他失败、前后置失败、逻辑运算符、管道、重定向、分号/换行、引号及路径/包装有显式回归与边界说明。
3. Node 24/26 Windows 手动专项、既有 Codex/协议相关回归、lint、格式、命名、typecheck/build、默认 suites 和 OKF lint 按实际执行记录。失败定位，未运行明确标记。
4. 审查完整 tracked/untracked diff、规则和接受项；证据存于本会话 outputs，仓库保留 validation/review/journal。
