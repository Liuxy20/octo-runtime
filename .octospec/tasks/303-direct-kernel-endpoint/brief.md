---
type: Task
title: "Issue 303：直接修改 Kernel 端点"
description: "按澄清后的范围直接改名，沿用当前所有权与恢复行为。"
tags: [runtime, ipc, lifecycle, testing]
timestamp: 2026-11-04T11:00:00Z
slug: 303-direct-kernel-endpoint
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/303"
---

# Issue 303：直接修改 Kernel 端点

## 目标与基线

基于已合并 #310 的 bd287f95，将共享派生函数的 POSIX Kernel 地址直接改为
`<home>/executor-kernel.sock`。这是破坏性地址变更；测试消费者停止旧进程，
同步更新 Kernel、客户端和 Extra 后重启。

用户授权按 #303 最新澄清精简并更新 PR #311。该澄清覆盖此前旧/新版本互斥和受控
迁移的要求；删除已引入的兼容机制及其专属测试、文档，不继续补全该机制。

## 保持的合同与范围

- 沿用 #306：SDK 宿主显式选择并准备绝对 Home；CLI 使用 --home 或 ~/.octo-runtime。
- Windows pipe/service 身份、Extra 控制端点保持。Kernel、attach、Extra、CLI
  status/doctor/recover 共用现有地址派生和状态路径，不改配置、凭据和身份。
- 当前端点的普通租约、校验、清理和恢复沿用主线；无关生命周期加固另行处理。
- 不添加旧布局检测/阻断、兼容租约、跨版本协调、迁移框架、别名或后备监听。
- 不修改 CI、默认 selector、workflow、依赖和锁文件；不自动合并或手动关闭 Issue。

## 验收

- 路径准确，保留 IPC 长度错误；验证自定义 Home、中文空格、字节边界及 Windows 身份。
- 显式专项验证实际 IPC 创建/attach/Extra/status/close 和既有恢复；未执行平台明确标注。
- 同步相关文档及 CLI profile 文件名冲突保护，简短说明停止/更新/重启要求。
- 确认 Kernel 实现和公共导出恢复主线，运行构建/类型、专项、相关回归和文档检查。
- 历史兼容版本的通过结果不计入精简版本；结果见 [验证](validation.md)。
