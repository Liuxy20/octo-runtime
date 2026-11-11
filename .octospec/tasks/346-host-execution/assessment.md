---
type: Assessment
title: Issue 346：方案可执行性 96 分评估
description: 基于最新 main 源码的规划自评，明确四分实施验证缺口与关闭条件，不替代测试或独立评审。
tags: [architecture, adapter, assessment, risk]
---

# 可执行性自评：96/100

用户要求严格超过 95 分。本评分衡量初始方案准备度，不是成功概率、实现质量、独立审查结果或真实环境通过率。后续授权实施后的实际检查见 validation，保留初始 96 分评分口径。

| 维度 | 满分 | 得分 | 依据与扣分 |
| --- | --- | --- | --- |
| 架构归属和范围 | 20 | 20 | 区分宿主选择、Adapter 协议和逐调用委托；不引入统一 Engine 平台，不侵入 MCP/业务策略 |
| 源码定位与 metadata 复用 | 25 | 25 | 已核对 Codex/OpenCode/ACP/专用 ACP、CLI、DSH/OpenClaw；明确静态声明、注入与 probe 投影分层 |
| 构造、环境与生命周期合同 | 25 | 23 | 启动前缀/协议 argv、环境优先级、冻结、probe/恢复同源、unavailable 装配已有方案；ACP 结构接口原型与 Windows 最终启动仍需实施证明，各扣 1 |
| 迁移与实施顺序 | 15 | 14 | M0-M4 与完整消费者列表可执行；#343/main 同步整合未发生，扣 1 |
| 验收与交付约束 | 15 | 14 | A01-A15 有断言、证据和真实/平台划分；真实 Provider 与包外证据未产生，扣 1 |
| 合计 | 100 | **96** | 剩余 4 分全部保留为实施验证缺口 |

## Gap 与关闭条件

| Gap | 分值 | 关闭条件 | 未满足时的处理 |
| --- | --- | --- | --- |
| G1：ACP factory 与本地绑定的类型可实施性 | 1 | M0 用公开构造完成 OpenCode 双路径及 ACP factory 原型，A01/A04/A09 编译和运行通过；无需伪造本地 command 或 ChildProcess | 调整 ACP 专用结构接口并更新文档；不扩大为通用 Engine 平台 |
| G2：Windows 启动链一致性 | 1 | 原生 Windows 的 A02/A04/A10 验证 probe/执行同一 npm 入口和 Node，环境别名与未知 batch 明确处理 | 保留未验项，不能用 POSIX 或模拟结果宣称 Windows 已通过 |
| G3：最新主线与 #343 整合 | 1 | 实施前重新 fetch、审查 owner/factory 差异，消除重复修改并确认 A07/A11/A12 | 更新基线和分工后实施；不以路径冲突为理由恢复隐式解析 |
| G4：真实执行和包外交付 | 1 | M4 产生真实 Codex/OpenCode 两路径、受影响 Provider 和包外构造证据，记录原生版本及清理事实 | 按 Provider/平台单列 not run/blocked；不得将本评分当验收完成 |

## 主要风险

实施状态：G1 已由无 ChildProcess 的结构 client、OpenCode 双路径及公开类型构建验证；G3 已 rebase main@c7ae0256 并重跑 #343 的 100 并发专项。G2 原生 Windows 尚未运行，Electron 仅模拟分支验证。G4 已完成真实 Codex 三轮、OpenCode JSON/ACP 各一轮和完整发行包离线安装/SDK/CLI 验证；其他 Provider 真实账号及平台仍未覆盖，不宣称全部环境验收完成。

- 单改工厂 command 不能关闭问题：底层 Windows runtime 搜索、probe 环境和 Codex 恢复都可能再次选择安装。
- 全部默认实例改成强制构造可能使 CLI 缺安装时整体启动失败；静态 metadata + unavailable 包装必须在 M2 同时接线。
- 逐轮 PATH 仍需传给 Provider 内部工具。禁止为了固定 executable 全局过滤 PATH 或破坏 envs/MCP。
- 固定路径不消除文件替换竞态，也不提供安全隔离；真实 Windows 后代回收仍受现有 Node/OS 合同限制。
