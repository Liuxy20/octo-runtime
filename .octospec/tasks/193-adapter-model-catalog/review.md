---
type: Review
title: Issue 193 PR 审查处理
description: 记录 yujiawei 对验收证据和 list 探测合同的意见及源码核对。
tags: [architecture, documentation, review]
---

# 审查来源

[yujiawei 对 PR 284 的审查](https://github.com/Mininglamp-OSS/octo-runtime/pull/284#pullrequestreview-5726227489)，对应提交 `1184c04cfe17ed819cd33ef36c0d1cd3d802e6f7`。

## 验收证据未覆盖 A9：接受

历史 journal 的 A1–A7 描述对应初稿，之后增加 A9 时未补明确的最终验收映射。补齐 [spec.yaml](spec.yaml) 和[验证记录](validation.md)，逐项说明 A1–A9；历史记录保留其时序，当前结论以最终验收为准。

## 公共 list 不返回探测：结论不成立，文档补充入口区别

审查引用的 Core `AgentExecutor.list()` 确实只返回元数据，但公共 `KernelClient.list()` 调用 `adapter.list`，并非直接调用 Core 的同名方法。

源码路径：`packages/octo-runtime-executor-kernel/src/client.ts` 的 `exchange("adapter.list")` → `server.ts` 的 `runs.list()` → Core `HostRunService.list()` 调用 `transport.list()` → `server.ts` 的 `worker.client.list(...)` → `rpc.ts` 的 worker `list` 分支 → `AgentExecutor.describe(...)`。后者运行 probe 并构造 `available`、`unavailableReason`、`providerPath`、`providerVersion`。

保留公共 IPC 返回探测信息的正确描述，在架构规则和双语 IPC 文档新增与 Core `AgentExecutor.list()` 的区别。未修改运行时代码，也未将探测结果解释为模型枚举。

## YAML 交付补齐

原交付的知识 Markdown 已有 YAML frontmatter；缺少的是独立结构化任务合同和最终逐项验收记录。此次新增 `spec.yaml`，`review.md` / `validation.md` 分别声明 `Review` / `Validation`，与 `context.yaml` 的用途分开。

## 最新审查：IPC 方法表与 wire 表描述不一致，接受

[对应 c8faa073 的审查](https://github.com/Mininglamp-OSS/octo-runtime/pull/284#pullrequestreview-5726469309)已确认规格通过、公共 Kernel 探测路径正确。剩余问题是双语 IPC 正文已说明 probe，但方法摘要仍说安装需另查，wire 返回值表仍仅写元数据。两处摘要均改为注册元数据及实际探测结果，列出四个返回字段；保留 Core 纯元数据入口区别及不证明登录/模型权限的限制。不修改实现。

用户进一步明确公共文档的消费者边界：宿主/Extra 使用暴露的 `KernelClient` 服务，不需要辨认内部同名方法。因此公共 IPC 正文只保留统一的 KernelClient 列表合同和已装配范围；Core 方法区别及源码路径留在架构规则和本审查记录，不呈现为公共 API 的两种选择。
