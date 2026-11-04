---
type: Task
title: Issue 302：失败取消后的再次显式 Stop
description: 区分新的显式取消请求与内部观察，恢复同一执行的再次 Stop 并保留首次控制失败。
tags: [kernel, cancellation, lifecycle, invocation]
timestamp: 2026-11-04T00:00:00Z
slug: 302-explicit-stop-retry
source: self
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/302
---

# 目标与基线

基线 main `5d6a1f93136204946be7eebc54c55b62f3287388`。取消失败后，新的一次显式 `cancelInvocation` 可对原 RunRef 发出新请求；并发调用仍去重。内部 drain、signal 后续处理和 ACK 接续不得因首次结果未知而自动重试控制，也不得重新 invoke。

## 意图与责任

- 用户/宿主决定再次 Stop；Runtime 只执行该显式控制意图，不自动补造重试。
- 首先违反合同的是 KernelClient 的 InvocationRegistry：它永久缓存失败的取消 Promise。Gateway 已允许新 Stop，无需在业务层兜底。
- 新控制沿原 ref，原调用/观察者继续得到自己第一次控制的真实失败。取消 ACK、执行终态、清理完成保持分别判断。
- 多产品共享此修复；公共 KernelClient 签名、协议、身份、Home、Provider 配置及默认策略不变。

## 承重合同与实现范围

- 新显式控制、并发去重、自动 drain 与原始失败观察分别处理；不清空执行登记来伪造完成。
- 保持取消并发上限、共享关闭期限、真实终态、未知状态和未确认资源。
- 仅修改 Kernel 客户端与内部调用登记，维护就近中文注释和本地执行规则。
- 专项置于 `test/manual/`，显式执行；不扩展默认测试选择器、CI 或 Gate。

## 验收

- Windows Node24/26：真实本地 IPC，首次请求在转发前丢失，新显式 Stop 使原执行收到取消；不重新执行 Provider。
- 取消 ACK 丢失、并发 Stop、慢清理时 drain 及终态竞争得到明确验证。
- 内部查询/排空不自动重复未知结果的控制；ACK 前同一意图不重复发送。
- 第二次控制成功不能覆盖首次控制调用及 invocation 观察链的原始失败。
- 运行相关 Kernel/Gateway 回归、lint、类型/构建和知识元数据检查；平台与真实 IM/Provider 缺口如实记录。

## 范围外

Home/endpoint、启动诊断、Windows 服务环境变量（#292/#303/#304/#306）、Provider 清理实现、真实 IM UI。用户后续已授权提交、推送与创建关联 PR；本次不合并或直接关闭 issue。
