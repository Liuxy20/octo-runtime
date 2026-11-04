---
type: Review
title: "Issue 303：直接改名范围自查"
description: "确认撤掉兼容层和无关加固，普通生命周期与主线一致。"
tags: [runtime, ipc, review]
timestamp: 2026-11-04T11:00:00Z
source: self
---

# 范围与承重路径

按 #303 澄清直接修改共享派生函数的 POSIX Kernel 分支，保留其规范化与预算断言。
Windows、service ID 和 Extra 控制分支未改变。CLI/SDK/attach/Extra 沿现有调用链取得
该地址；CLI 清单继续在 Home/run 下，不改变 Home、配置、凭据或身份。

Kernel endpoint/server/runtime-home/index、public host/executor-kernel 及 CLI output
七个文件恢复为 bd287f95 的完整内容。删除新增的布局模块、兼容错误/导出、旧 owner/
socket/.runs 检测、双布局租约和专用恢复路径。普通 owner、校验、清理与恢复未重写。
初版评审涉及的新增兼容/严格归属路径不再存在；本次不另建方案补全它们。

CLI 仅新增与直接 socket/owner/state 文件相撞的保留 profile 名。测试与双语文档
同步直接地址，简短说明停止旧进程、同步更新后重启；删除专用升级指南及无效链接。
没有 workflow、默认 selector、依赖、公共 API 或协议变更。

## COMPREHENSION

1. 改变：POSIX Kernel 在指定 Home 根使用直接 socket；所有现有使用方共用派生结果。
2. 影响：硬编码旧地址的测试消费者必须更新并重连；不提供跨版本协调或自动迁移。
3. 证据：精简版本重新构建并跑显式专项/相关回归，具体结果与未执行平台见 [验证](validation.md)。
