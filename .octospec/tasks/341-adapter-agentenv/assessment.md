---
type: Review
title: 实施前可执行性评估
description: 将用户决定映射到执行链、消费者、风险和可观察验收。
tags: [architecture, adapter, planning]
---

# 可执行性 95/100

这是实施前准备度，不代表实现或验证通过。

| 维度 | 分数 | 已确定依据 |
| --- | --- | --- |
| 需求与责任 | 20/20 | 用户明确 Core 透传、Adapter 私有消费、共性协议/私有 bean 分开、无兼容层 |
| 代码定位 | 20/20 | 已定位 prepareInvokeInput、resolveLocalContext、协议校验/schema、defineAdapter、全部 Adapter 消费、Kernel 选项合并 |
| 设计完整性 | 19/20 | 单一信封，Adapter 默认配置/读取帮助类，本地预算回调和可信连接上下文均有落点 |
| 验收可执行性 | 19/20 | A01-A06 覆盖 direct/RPC、扩展保序、原生映射、生命周期和既有回归；专项不扩大 CI |
| 风险与迁移 | 17/20 | 跨 98 个测试/支持文件有旧请求形状，须同步；各真实 Harness 安装/账号尚未核实，独立记录 live 限制 |

## 风险处置

- 最大风险是换名后保留重复投影：以 Core 无配置解释及旧模型零现行引用作为验收。
- 权限与目录前置失败迁移后仍须在 Provider 启动前发生；SDK 包装器承担检查。
- Core 时间控制仍由 Core 执行，配置解释由 Adapter 完成；回调只传生命周期预算，不再构造 Agent 配置。
- 公共模型/effort bean 保留；不将 Harness 私有选项登记入中央 catalog。
- 基线为 origin/main d5aeae707fcda0b138b360136f164c085c9a5e87，独立 managed worktree，无提交授权。

无待用户决策项，进入实施。
