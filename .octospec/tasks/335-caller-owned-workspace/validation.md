---
type: Validation
title: Issue 335 验证记录
description: 工作目录合同、错误码及与 Issue 334 联合交付的实际证据。
tags: [validation, workspace, protocol]
---

# 实际验收

实现提交 `b645a474`；完整命令、失败修复、环境、双包、原生验收与限制见 [联合验收](../334-caller-owned-prompts/validation.md)。W1–W8 的本地范围完成：path-only、旧 mode 拒绝、负向类型、显式真实 cwd、五种 WORKDIR 原因码、Provider 启动前失败、续接缺目录不补建、外部/preset 例外及用户数据保留均有专项/回归证据。

目录/Core/IPC 显式专项 7/7，协议/类型专项 5/5；与 #334 合计 16/16。全量 1548 通过、61 既有条件跳过；双包外部检查通过。真实 Codex/Claude 两种视图仅证明本机简单普通文本在显式 cwd 执行成功，不代表其余 Provider、真实恢复、多模态、跨平台或 Gateway 端到端通过。

Gateway #23 未实施。用户没有授权在此恢复该任务；只读消费者审计见 [gateway-audit.md](gateway-audit.md)。无 CI 扩围、数据迁移/删除或 npm 发布。
