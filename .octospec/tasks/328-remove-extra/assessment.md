---
type: Task
title: Issue 328：实施前可执行性评估
description: 根据实际代码入口和验证出口评估准备度，不代表实现或发布完成。
tags: [architecture, testing, channel]
---

# 可执行性：95/100

| 维度 | 得分 | 依据 |
| --- | --- | --- |
| 目标与决定权 | 20/20 | 用户明确独立 Git 仓库、删除范围，Issue 和 brief 固化 |
| API 与依赖 | 19/20 | client 已有 invoke/错误/protocol；register 定义与句柄明确 |
| 生命周期与失败 | 19/20 | 复用 Manager/ImRuntime 关闭与 client drain，共享截止、失败回滚 |
| 迁移覆盖与顺序 | 19/20 | 已定位 exports、CLI main/command-tree/manifest、Host SDK、native、打包与测试 |
| 验收与证据 | 18/20 | 类型/离线/实际 tgz/包外验证明确，真实 IM 与多平台分开记录 |
| 合计 | 95/100 | 达到用户实施门槛，进入实施 |

剩余 5 分：实际包外协议和错误类一致性待验（1）；清理竞态需专项（1）；混合 CLI/发行测试及文档残留需全库检查（1）；真实 IM 和 Windows/Linux 尚无本轮证据（2）。均有 brief 中的验证出口，不把未知写成已支持。实现发现阻断需修正方案与评分。

CLI 补充复核：已定位原 `cross-service` 的 launchd/systemd/Windows Task 后端、服务 spec、配置原子写和日志实现。迁移为 Gateway CLI 的私有服务管理代码；npm 单包同时导出 SDK 和 bin。测试以可注入 backend 覆盖 install/start/stop/uninstall 和 endpoint 保留，真实系统服务操作另行记录。补充范围仍有既有实现和明确验收出口，准备度保持 95/100。
