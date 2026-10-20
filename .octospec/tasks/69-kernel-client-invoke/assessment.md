---
type: Review
title: Issue 69 规划可执行性评估
description: 根据源码定位、确定合同、验收断言与实施依赖评估规划准备度，区分用户确认与未来证据。
tags: [architecture, invoke, lifecycle, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 结论和评分口径

本轮规划的工程可执行性自评为 **96/100**，超过用户要求的 95 分。这个分数回答“开发者能否据规格开始实现，验收者能否判定结果”，不表示功能完成、测试通过比例、成功概率或独立评审结论。

需求来源、源码边界和破坏性更新授权已核实；用户在规划评审后明确要求“开始实施”，现按本设计执行。96 分仅保留为规划准备度，不能代替代码验证或平台验收。

| 维度 | 满分 | 得分 | 有据可查的完成条件 | 扣分依据 |
| --- | --- | --- | --- | --- |
| 需求与边界 | 20 | 20 | Issue 八项合同与七项原验收已对应；用户确认破坏性更新、Gateway 只处理结果 delivery | 无关键范围缺口 |
| 接口与模式 | 20 | 19 | 现有 InputInvoke 三重载、公共入口、惰性启动、控制方法、兼容删除清单明确 | 新方法/辅助类型需最终方案确认及包外编译证明 |
| 身份、故障与取消 | 25 | 24 | 原身份/游标、次数预算、阶段矩阵、错误优先级、lost/unknown 可观察性明确 | 时序交错需 M1 受控 relay 实测 |
| owner 与资源 | 15 | 14 | 登记上限、未知占额、无新增逐 Run 订阅、共用绝对 deadline、incomplete 条件明确 | M2 需验证饱和连接下取消/查询公平性 |
| 任务与依赖 | 10 | 10 | M0-M5、具体文件、完成门槛及 #65/#66/#30 关系明确 | 无隐含未合并前置 |
| 验收与证据 | 10 | 9 | A01-A32 可观察断言、故障计数、包外 strict 编译、三平台路径和文档门禁明确 | Windows 和线上证据只能在实施后取得 |
| 合计 | 100 | 96 | 所有条目见 brief/design/acceptance/plan | 不对未执行验证加分 |

## 规划中已消除的实现分歧

| 缺口/风险 | 处理决定 | 防线 |
| --- | --- | --- |
| 仅在 SDK 添加 invoke，零 Extra App 仍不可用 | invoke 放 KernelClient；owned.client 同类型 | A01-A05 |
| 把 Extra port 改名后继续提供第二套执行接口 | 删除文件/类型/字段；SDK 注入实际 client，登记和身份控制归 Kernel | A04-A06/A31 |
| Gateway 变成执行可靠性的维护者 | Gateway 只消费结果做 delivery，原提交/续接只在 Kernel client | A04/A11-A16 |
| 原 submit 与 invoke 对同一 signal 双发取消 | 共享内部取消意图和一次发送记录 | A18-A21 |
| createInputInvoke.finally 遮盖 ACCEPTANCE_UNKNOWN 等错误 | 更具体错误优先，只在正常耗尽后抛 abort reason；补 Core parity | A12/A19/A21 |
| status 等待期间 abort 后仍发 invoke | status 后、写请求前增加检查 | A17 |
| 4 秒 Extra 关闭却先等 30 秒接纳或 10 秒恢复 | 所有等待共享截止时间，未确认列 unresolved | A26-A27 |
| 每 Run 增加排空订阅超过 16 个限额 | 原 source 收尾，其他记录通过有界 get 核对 | A29 |
| 流关闭/lost/cancel ACK 变成成功 | 明确状态和错误，保留原身份及未知登记 | A12/A16/A20/A22 |
| PR #65 被误当已合并前置 | 读取确认 OPEN，实施前检查重叠文件，不依赖其分支 | M0/M3/M5 |

## 需求与方案确认记录

需求确认 C01：用户已允许破坏性接口重构，不保留旧版本兼容层。需求确认 C02：用户已限定 Gateway 对 invoke 输出做 delivery，不维护 Kernel 执行步骤。两项均有本轮会话原文依据。

设计建议 C03：保持现有 InputInvoke 的异步流/模式重载，ctx.kernel 注入实际 KernelClient；按 invocationId 的控制与 owner 登记位于 Kernel client。设计建议 C04：caller signal 请求取消并保留尾流，正常耗尽后抛实际 reason；owner 显式排空且受既有总期限限制；断开观察不隐式取消。设计建议 C05：不兼容旧 port，保留原 wire/Run/Context，额外本地生命周期类型不进 wire。

C03-C05 形成可评审合同后，用户明确发出“开始实施”，据此执行；没有用等待时间或沉默代替授权。实施保持上述边界。

## 本轮实际验证

已核对本机仓库和 GitHub issue/PR 状态；已创建新的 feat worktree。基线 OKF lint 通过：249 个单元、20 条规则、1570 个本地文件链接。系统 python 缺少 PyYAML，使用现有 uv 临时依赖运行同一仓库脚本，不修改项目依赖。

最初规划校验记录在 context.yaml；之后产品构建、测试、包外验证及未验范围统一见 [实施记录](implementation.md)。没有真实模型或消息投递，也没有 Git commit/push/PR。
