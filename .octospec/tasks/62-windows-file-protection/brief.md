---
type: Task
title: Issue 62 文件保护测试的 Windows 兼容判据
description: 定义 Windows 文件权限测试判据的修复范围、平台边界与验收要求。
tags: [testing, windows, mcp]
timestamp: 2026-10-27T00:00:00Z
---

# Issue 62：文件保护测试的 Windows 兼容判据

## 目标与证据
- 基线 `aa16c894b2b2c7ae9a2771cf10a427f7b677c976`；原生 Windows 11 / Node 24.22.0。
- MCP 测试第 150 行仍复现 `438 !== 384`；OpenClaw 功能通过，WebUI 功能通过且 POSIX 权限测试在 Windows 跳过。
- 修复平台测试判据，使内容、清理和 Provider overlay 的原始断言完整执行。

## 关键合同与归属
- 用户要求兼容修复、SDK 接口不变、最小必要改动，仅处理 #62。
- 生产实现已有文件创建 mode、临时目录和清理；本任务不改变其访问策略。
- POSIX 保留普通文件及 `0600` 检查。Windows 测试读取 fixture 的 DACL，验证读取授权限于当前账号、SYSTEM 和本机 Administrators；不修改真实配置或系统策略。
- DACL 判据保守拒绝其他主体的读取 Allow ACE，不承担任意 Windows deny/group/有效令牌的通用授权计算。测试需要当前账号的私有临时目录；无法读取 ACL 或目录授权不符合此前提时明确失败。
- 用独占虚构文件增加 Everyone 读取 Allow ACE 作 Windows 负向对照；POSIX 对照显式 chmod 为 `0666`，不依赖宿主 umask。
- 仅测试进程调用系统自带 PowerShell；无新运行时依赖、原生二进制、公开导出、协议或服务拓扑变化。

## 范围
- 测试专用共享判据及其正负对照。
- MCP 原失败位置、OpenClaw 已分平台位置、WebUI 已迁移权限测试共用判据。
- Windows CI 的既有文件安全步骤运行上述相关用例，覆盖 pwsh 父进程的模块路径继承。

## 不在范围
- #39 持久化实现、G06 symlink 前置权限、SDK/Adapter 公开接口及生命周期重构。
- 新 ACL 产品策略、运行时 chmod/ACL 修补、真实凭据或跨账号登录验证。

## 验收
- 原 MCP 聚焦命令完整通过，无诊断 loader。
- OpenClaw、WebUI 内容及清理断言保留；权限检查在 Windows 实际执行。
- 明确公开的虚构文件被判据拒绝；POSIX `0600` 检查保留。
- 执行相关五个测试文件、格式、lint、命名与类型检查；非本平台结果明确记录。
