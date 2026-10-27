---
type: Task
title: 修复 Linux systemd 路径指令序列化
description: 定义 systemd 工作目录与日志路径指令修复的范围和验收要求。
tags: [linux, systemd, lifecycle]
timestamp: 2026-10-22T00:00:00Z
---

# 修复 Linux systemd 路径指令序列化

## 目标与责任归属

- 需求：GitHub Issue #113；从最新 `origin/main` 的 `fe19d35` 新建独立 worktree。
- 业务目标：Kernel 与 Extra 使用 Linux 后台服务时，原生 manager 能加载定义、进入指定目录并写入指定日志。
- 决定权：调用方提供 `ServiceSpec` 路径；cross-service 仅负责 systemd 原生映射，不猜测业务配置、不改变服务拓扑。
- 合同内动作：分离 argv/env 引号与路径指令序列化，保留字面量 `%`、内部空格、引号、反斜杠和 Unicode；修复已确认同样错误的 append 日志指令。
- 越界动作：不改 macOS/Windows、不改前台 run、不代启其他组件、不改变 install 的首次不启动及幂等合同。
- 其他产品：共享 Linux backend 的 CLI/SDK 同时修复；公共 API 与组件所有权不变。

## 方案与验收

systemd 的 WorkingDirectory 和 append 日志指令不执行 argv 式去引号或 C 反转义，因此直接写入路径，仅将 `%` 编码为 `%%`。ExecStart 与 Environment 沿用现有引号。
原生配置会裁掉行尾空格或制表符，并将换行前奇数个行尾反斜杠解释为续行：序列化时为奇数尾部反斜杠附加一个保护空格，避免续行，随后由原生 strstrip 移除保护空格；偶数个原样保留。路径本身的尾部空格或制表符不可无损表达，明确返回 UNSUPPORTED_SPEC，避免静默改变目标；原生未裁剪的垂直制表符和换页符保持不变。

- 普通路径、含空格、字面量 `%h`/`%n`、引号、反斜杠与 Unicode 的确定性渲染回归。
- ExecStart 与 Environment 的引号行为不退化。
- 重新 install 替换旧坏 unit，daemon-reload 先于 start；再次 install 不额外 reload/restart。
- 注入 runner 的重装修复 fixture 显式传入隔离 environment，分别覆盖默认目录与绝对 XDG_CONFIG_HOME；原生 fixture 从 backend.inspect 获取真实 definitionPath，禁止硬编码默认目录。
- Linux 原生 systemd-analyze 验证无警告；可选真实 user manager 测试确认旧 unit 修复、cwd 与两路日志实际落点。
- 验证真实 CLI Kernel 与已配置 Extra 的 install/start，记录环境及边界，不将 fake runner 当原生证据。
- 提交前 rebase 最新 main，双轴 code review，英文 commit 与 PR 关联 Closes #113；等待 reviewer 合并，不自行合并。
