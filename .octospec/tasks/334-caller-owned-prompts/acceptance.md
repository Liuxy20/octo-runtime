---
type: Task
title: Issue 334 验收矩阵
description: 删除边界、输入生命周期和双包升级的验证依据。
tags: [protocol, validation, adapter]
---

| 项 | 验收要求 | 证据入口 |
| --- | --- | --- |
| A1 | 公开类型与导出不存在指令类型、字段/helper；旧调用编译失败 | 生成漂移、包外 TypeScript 专项 |
| A2 | Schema 和运行时均拒绝旧 item 及 AgentEnv/InvokeRequest 旧字段，包括空值；错误有迁移方向 | 标准 Draft-07/运行时手动专项、既有协议测试 |
| A3 | 新建/续接/fallback 普通文本、图片和交替 parts 保序且不重复注入 | Core/client/Adapter 捕获的真实请求形状，fake Provider |
| A4 | 所有原注入路径不再提交 Runtime 指令参数/文件；CodeBuddy 无尾部分隔符 | Adapter 回归和显式手动专项 |
| A5 | MCP/env/workdir/model/effort/policy 仍应用，原配置不被修改 | 现有 context-mcp/context-envs/输入回归 |
| A6 | 初始/续接/恢复背景由调用方构造；迁移例子同时包含提示词与图片 | 双语文档、docs checks |
| A7 | Runtime 和独立 client 公开 Schema/类型一致，包外旧字段拒绝 | 两包 pack/verify、包外 client 专项 |
| A8 | Gateway 旧消费者定位准确并明确未迁移后果，不声称仓外验收 | 只读消费者审计记录 |
| A9 | 格式、lint/names、typecheck、全量 suites、OKF 检查通过 | validation.md 实际命令和结果 |
| A10 | 不扩大 CI、源版本不跳升、正式 PR 及 main 状态真实 | workflow diff、checks 列表、远端提交 |

本矩阵是待执行条件，不预填通过；专项仅显式手动执行。原生 Provider 与 IM 证据独立记录，未执行即未验证。
