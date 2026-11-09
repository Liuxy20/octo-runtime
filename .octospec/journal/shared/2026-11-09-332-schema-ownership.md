---
type: Journal
title: Issue 332 Schema 职责清理
description: 记录独立 worktree、96 分规划、实施及本地验证结果。
tags: [protocol, schema, packaging]
---

# 交付记录

从最新 main `86b3379c` 建立独立 worktree/分支 `refactor/332-schema-ownership`。用户授权 octospec 方案、至少 95 分后实施、正式英文 PR 并合并 main，追加不用管 Work App；不发布、不扩大 CI。

M1 `63486248` 写入[方案](../../tasks/332-schema-ownership/brief.md)与 96/100 可执行性评估；M2 `15d0b815` 完成两个 Schema 与测试分离、删除行为配置/13 个旧定义/5 个校验器、派生运行时常量、双语文档和显式双包资产。七份 fixture 字节不变，96 个保留定义结构不变，公开 IPC 样本路径保留。

本地 1546 项通过/61 条条件跳过/0 失败，手动清理 6 项、client 包外 11 项及完整 Runtime 离线安装/SDK/CLI 验证通过。初次手动验收发现旧 v1 兼容期望失效，改为真实旧 Kernel 拒绝且零执行；完整文档检查通过。独立审查无未关闭问题，详见[验收](../../tasks/332-schema-ownership/validation.md)与[审查](../../tasks/332-schema-ownership/review.md)。

workflow/默认测试选择不变；main 既有 CI Gate 和一位批准规则保持。真实模型/IM、外部应用及 Windows/Linux 原生服务不作已验承诺。正式 PR 与合并状态以远端为准，后续记录至任务交付节。
