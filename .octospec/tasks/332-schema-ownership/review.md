---
type: Review
title: Issue 332 实施审查
description: 从规范和需求两方面复核 Schema 清理与实际发行内容。
tags: [protocol, schema, review]
---

# 审查范围

比较起点 main `86b3379c` 与 M2 `15d0b815`，包含源定义、生成代码、client/server 版本常量、公开导出、双语文档、打包和手动测试。独立审查代理不编辑、不提交；根负责人复核验证结果。

## 规范

- 协议数据、客户端默认值和测试资产归属清楚；不引入通用业务 schema/插件或另一套配置。
- Schema 使用既有生成器；新增两个运行时合同常量从源定义派生，没有新运行依赖。
- 客户端/status/server 实际 v2 值不变；取消、恢复与终态没有改动。
- 13 个删除类型没有保留定义的入边；五个旧校验器只有已删除的专属测试使用。
- workflow、根默认测试选择与 lockfile 未改，新专项显式手动运行。
- Git 配置作者保持，英文提交及 Codex trailer 已核对。

## 需求

- schema 目录仅有两个标准 Draft-07 文档；7 份正反样本原样迁入 test/fixtures。
- behavior JSON/公开导出及失去消费者的 x-octo-methods 删除；客户端默认值保持在实际实现，不复制成新 config。
- 两份 tgz 的实际目录与公开 fixture 导入已验证，包中不再意外收集所有测试 JSON。
- 96 个保留定义与基线逐项结构相同；Run 错误码内容/顺序不变，IPC 版本值仍为 2。
- 双语升级说明完整列出 13 个类型、5 个校验器、behavior 导出和 Schema ID 变更，以及标准校验与 x-octo 语义的边界。
- 用户追加不用管 Work App，未将外部兼容或改动作为清理前提。

## 修复后复审

旧手动脚本的 IPC 断言已更新：真实旧 Kernel 被当前 client.submit 拒绝、Provider 调用数为 0、旧服务仍可查询并正常清理。unsupported status 使用 v1，日志断言仅有 status 请求。README 两种语言的删除清单与实际修改一致。

结论：未发现需要修复的剩余问题。真实模型/IM、外部应用和跨平台原生服务的未验范围保留；远端 CI/审批/合并尚须按实际状态完成，不以本地审查代替。
