---
type: Validation
title: Issue 302：Windows 复现与修复验证
description: 绑定源码基线，记录失败取消后的新显式控制、真实 IPC 与回归结果。
tags: [windows, kernel, cancellation, validation]
timestamp: 2026-11-04T00:00:00Z
---

# 基线与环境

- main `5d6a1f93136204946be7eebc54c55b62f3287388`；分支 `fix/302-explicit-stop-retry`，验收时为相对基线的未提交 diff。
- Windows 11 Enterprise 10.0.22621 x64，普通用户，PowerShell 7.6.5。
- Node 24.19.0 / 26.13.0，pnpm 11.19.0；frozen lockfile 安装成功。
- 每次测试使用所有 checkout 外的独占 Home/TEMP/TMP/APPDATA/LOCALAPPDATA；fake Adapter、真实 Kernel 与 Windows Named Pipe relay，不接真实模型/IM。

# 修复前

两版各执行初始7项专项：4 pass、3 fail、无 skip，退出码1。失败为：新显式尝试仍只有1次底层调用；真实 IPC 首次请求丢失和首次 ACK 丢失后，第二次 Stop 仍报 `OPERATION_OUTCOME_UNKNOWN`。测试 finally 用独立客户端回收本用例原执行，入口自然退出。

该结果是缺陷复现，不计通过。两版原始记录分别为受控证据目录的 `node24-baseline`、`node26-baseline`。

# 修复后专项与相关回归

命令（在仓库根，使用相应 Node）：

```text
node --unhandled-rejections=strict --test --test-reporter=tap --test-concurrency=1 test/manual/explicit-stop-302.test.mjs test/kernel-invoke.test.js test/kernel-clients.test.js
```

两版均39项 pass、0 fail、0 skip，退出0。修复后专项8项（增加真实 IPC 自然完成竞争），其余为既有 Kernel 回归。

真实 IPC 对照：首次请求在 relay 转发前丢弃，第二组显式 Stop 两个并发调用只新增1次控制；两次请求 ref 完全相同、reason 来自新意图，Provider start 与 invoke 均为1，真实终态为 cancelled。首次 ACK 丢失场景保持相同原执行与首次错误对象。自然 completed 竞争返回 accepted=false，不重放业务。慢清理时 drain 只查询原结果，不重发丢 ACK 控制，清理释放后观察真实终态。

专项在手动目录内显式运行，未加入默认测试/CI。

# 全量与静态检查

两版各执行现有 `pnpm test:suites`：UI均35/35通过，Node均2401项，2320 pass、2 fail、79 skip，退出1，无外层超时。专项位于手动目录，不计入默认2401项。

两项失败均为 `openclaw-runtime-connection.test.js` 的 typed/untyped legacy CLI启动恢复，报 `SERVICE_INITIALIZATION_FAILED (ORPHAN_CLEANUP_INCOMPLETE)`。同SHA未修复 checkout 的此前全量记录也包含这两项；本次不归为取消修复的新增失败，不推断其根因，也不声称全量绿色。

- 基线及修复后 `pnpm typecheck`（含 workspace build）均退出0。
- 构建结束后重新执行 `pnpm lint`、`pnpm format:check`、`pnpm lint:names`，均退出0。
- `.octospec/scripts/lint.py` 使用已有 Python3.12/PyYAML6.0.3 环境，最终退出0；633个知识单元通过。
- 最终产品代码只有客户端和内部登记的修改；无协议生成文件、CI、默认测试选择器或无关格式化差异。

# 验证限制与交付

未执行 macOS/Linux、真实 IM Stop UI 或生产 Provider 验收。代码修复不改变原公共协议或生命周期所有权。本地复现与自查不代替外部 review/CI。用户已授权提交、推送和关联 PR；合并由后续评审决定，issue 在对应 PR 合并时关闭。
