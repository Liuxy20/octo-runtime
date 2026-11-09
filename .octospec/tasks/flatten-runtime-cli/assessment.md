---
type: Review
title: CLI 平铺方案可执行性评估
description: 实施前可执行性 96 分，实际验证另记。
tags: [runtime, lifecycle, planning]
---

# 可执行性：96 / 100

- 目标与命令边界：20/20，用户明确删除前缀，无兼容诉求。
- 代码定位：20/20，command-tree/help/main/service-control 与 startup-catalog 已定位。
- 所有权及迁移：19/20，保留服务 ID/Home/JSON，旧安装显式重新 install。
- 验收路径：19/20，现有 CLI/服务/发行回归可复用，新增拒绝旧前缀及生成 argv 断言。
- 交付与风险：18/20，独立 worktree/PR，跨平台由现有 CI 检查；本机不冒充原生 Windows/Linux 服务实测。

已达到用户要求的 95 分实施门槛。此分数只代表方案可执行性，不代表测试通过或平台验证完成。
