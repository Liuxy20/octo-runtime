---
type: Task
title: Windows WebUI 会话保存修复
description: 修复 Issue 39 的瞬态文件替换失败、失败清理与状态保持。
tags: [webui, storage, windows, testing]
timestamp: 2026-10-22T00:00:00Z
slug: windows-webui-session-save
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/39
---

# Windows WebUI 会话保存修复

## 目标与职责
顺序创建会话时，Windows rename EPERM 使保存返回 500。WebUI 内部存储负责完成显式保存或如实失败；修复留在插件内部，公开 SDK/API/配置、JSON version=1 及会话容量保持不变。

## 关键合同
- 同一串行任务只执行业务回调一次；只重试本次临时文件的替换，不重放 HTTP 请求或临时写入。
- 仅 Windows rename EPERM 重试，最多 8 次替换、3170 ms 累计退避；耗尽或遇到其他错误时返回最后一次原生异常。
- 独占创建成功才取得临时文件所有权；写入、关闭、替换失败均尝试清理。关闭和清理的次级错误不得覆盖保存错误，诊断异常不得影响保存结果。
- 不先删除旧文件；rename 成功前不提交内存。成功即提交点，此后没有会把成功变成失败的清理或诊断。
- 后续操作基于最后成功状态，失败变更不得污染内存、revision 或下一次落盘。

## 验收
- 原生 Windows 对比修复前后的顺序保存，覆盖真实 EPERM 及受控句柄占用的恢复和耗尽。
- 注入部分写入、关闭、替换、清理失败，检查原生错误、所属文件、磁盘内容、内存及队列恢复。
- 完整 HTTP 流程覆盖创建 101 个会话、淘汰、更新、revision 冲突、内容重载、删除及清空后重载。
- 0600 保留为独立 POSIX 检查，使保存功能流程可独立执行。
- 运行相关回归、类型检查、lint、格式和命名检查，核对公共导出与存储格式。

## 实施结果
独占文件所有权、失败清理、有界替换重试和 rename 提交点已实现。原生 Windows 相关回归 24 通过、1 个 POSIX 检查跳过；具体对照及检查结果见[验收记录](../../journal/shared/2026-10-20-windows-webui-session-save.md)。
