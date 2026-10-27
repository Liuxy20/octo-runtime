---
type: Task
title: "Issue 63：分离模拟 Unix 服务路径与本机测试存储"
description: "仅修复跨平台 fixture，使原有服务管理和 CLI 断言在 Windows 上真正执行。"
tags: [testing, installation]
timestamp: 2026-10-27T00:00:00Z
slug: 63-unix-service-fixtures
source: self
upstream: "https://github.com/Mininglamp-OSS/octo-runtime/issues/63"
---

# Issue 63：模拟 Unix 服务 fixture

## 目标与事实

基于 main@5c0d2c6，Windows 11、Node 24.22.0、pnpm 11.19.0；原两个完整文件 35 通过、15 失败。修复模拟 Unix spec 混用宿主路径的问题，使这些用例到达原有功能断言。

## 责任与合同

- 测试决定模拟 Linux/macOS，负责提供合法 POSIX command/cwd/log 路径，并将实际 IO 留在独占的本机临时目录。
- 产品保持严格平台路径校验、原有 SDK/CLI 接口及默认值；fixture 不要求真实服务管理器或 Provider。
- CLI 仍调用真实 LaunchdUserBackend 的安装、查询、启动和重启实现；IPC server 属于测试，仅查询目标 Extra。
- 保留安装幂等、reload/enable/no-implicit-start、显式 bootstrap、异步 bootout 顺序及四种 override 断言。

## 范围外

SDK/API/类型/schema、产品源码、#89 endpoint 语义、真实系统服务安装、跳过失败、吞错或增加超时。

## 验收

用户明确本任务以原生 Windows 验证为准，并授权提交 PR；其他平台的本地验证不作为本次提交前置条件。

- 两个完整测试文件通过，原有 50 项无跳过；补充严格平台路径拒绝及必要的映射断言。
- fake Windows task 用例通过；所有生成文件位于测试拥有的原生临时目录。
- 执行格式、lint、命名、类型检查和相关服务回归；无法执行的原生 macOS/Linux 验证明确记录。
