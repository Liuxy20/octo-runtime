---
type: Task
title: Issue 58：Windows CLI 关闭与取消兼容修复
description: 使用真实控制台事件验证前台退出、执行终态及所属资源回收，保持 SDK 公共接口。
tags: [windows, testing, lifecycle, ipc]
timestamp: 2026-10-26T00:00:00Z
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/58
---

# Issue 58：Windows CLI 关闭与取消兼容修复

## 目标与范围

仅处理 #58 正文与补充中的 foreground、module-loading、Playboard Windows 关闭测试。Windows child.kill 强制终止不能验证真实 Ctrl+C；使用测试拥有的独立隐藏控制台，保留 POSIX 分支和独立强杀检查。

CLI 直接构造临时 Kernel，Kernel 监督 worker，Extra 独立管理。控制台事件由 fixture 投递，执行取消及终态由现有 Kernel 链路处理。worker 不因共享控制台事件抢先退出；Playboard 清理失败保留原执行结果。平台差异封装在内部，不增加 SDK 参数、方法、导出、schema 或产品依赖，不恢复旧 daemon，不接管调用者 Home/profile。

## 验收

- Windows foreground 与 module-loading 真实 Ctrl+C 为 0/null；Playboard 为 130/null，源终态唯一且 cancelled。
- 保留有界关闭、所属 PID/IPC 回收、兄弟组件独立、重启和后续调用断言。
- 三份完整测试文件通过，正常、pending、失败及清理故障均保留覆盖；不扩大 timeout、不新增 blanket skip。
- foreground 在默认全仓并发中通过原 20 秒预算。状态查询沿用已有假 ServiceBackend，真实组件与 IPC 不变。
- 仅用 fake Provider 和隔离状态。控制台工具在忽略的独占测试构建缓存编译，不进入 Runtime Home 或发行物。
- 按范围完成构建、类型、lint、format、命名检查并审查公共接口 diff。

用户已授权提交、通过现有 SSH 身份推送分支，并创建关联 #58 的 PR；不自动合并。

PR #183 评审修复：仅处理本次新增的 Playboard 测试临时根目录。macOS 清理故障 fixture 在 `/tmp` 下独占分配短目录并注册清理。同步最新 main 后，取消用例保留主线新增的长 TMPDIR 回归和既有 IPC 短路径实现；保留全部取消、终态及资源断言，不改 SDK 或主线产品策略，不扩展到非阻塞的 CI 建议。
