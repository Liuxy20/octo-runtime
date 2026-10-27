---
type: Task
title: "Issue 89：按选定平台派生端点"
description: "修正 Host SDK 路径辅助函数混用 Windows 宿主语义的问题，保持现有 SDK 合同。"
tags: [runtime, identity, ipc, testing]
timestamp: 2026-10-27T10:56:26Z
slug: 89-platform-endpoint
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/89"
---

# Issue 89：按选定平台派生端点

## 目标与依据

基线 main `005116ec7a28e27ccaddde75057e6289cfb549a5`。原生 Windows 11、Node 24.18.0、pnpm 11.19.0 下，匹配源码构建后的 `node --test test/runtime-endpoint.test.js` 为 0 通过、1 失败：显式 darwin/linux 的 `/tmp/runtime` 返回 `c:\tmp\runtime\sockets\octo-runtime-executor-kernel.sock`。源码及编译产物的补充 44 项检查均为 30 通过、14 失败；默认 Windows 管道 fake Provider 调用通过。

已有 platform 参数决定字符串路径语义。规范化和 endpoint 拼接须共同服从该参数；非 Windows 分支不能使用宿主 path 实现，也不能在内部丢失 platform。修复责任属于当前 Host SDK 辅助函数，调用方无需增加选择或转换路径。

## 关键合同与范围

- 只修复 `endpoint.ts` 中非 Windows 的规范化、拼接与参数传递，并补 `runtime-endpoint.test.js` 回归。homeHash/componentServiceId 已传递 platform，保持其实现。
- 保留方法签名、导出、默认参数、Windows 小写规范化、命名管道格式、哈希算法及长度、组件名校验和 Home/组件隔离。
- 所有函数仍只做字符串计算；不创建文件、监听端口或管理进程。现有 CLI/SDK 调用方、服务部署、IPC 协议和生命周期均不变。
- 不修改其他 Home 工具、#63 的服务输入夹具或其他 issue；不引入平台选择器、依赖、状态迁移、路径补救和 blanket skip。
- 用户在复现与本地修复后授权：核对 Issue 范围内的问题及验证结果，满足后提交、推送并创建关联 #89 的 PR；不改 Issue 正文、不合并或发布。

## 验收

- 原测试及独立 darwin/linux 回归在 Windows 通过；确定性绝对 POSIX fixture 不带入盘符/反斜杠，保留大小写和字面反斜杠。
- normalizedHome/homeHash/componentServiceId 对确定性路径符合预期，endpoint 的 Home/组件隔离和有效/无效组件校验保留。
- 固定 Windows fixture 的规范化、hash、pipe、service ID 和大小写行为不变；默认调用与显式 process.platform 一致。
- 原生 Windows 相关构建、格式、lint、命名和默认 IPC 回归通过；核对公共声明、导出、默认参数和调用方无漂移。
- 明确区分 Windows 上显式 POSIX 字符串测试与 Linux/macOS 原生验收，不宣称执行了未运行的跨平台检查。
