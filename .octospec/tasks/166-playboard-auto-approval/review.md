---
type: Review
title: "Issue 166：实现双轴审查及处置"
description: "记录未提交实现相对固定主线的规范与规格独立审查，以及问题修复与复查。"
tags: [cli, interaction, protocol, testing, review]
---

# 审查对象

固定基线 `4a0f53b50723422d90f051944ae19eb28f60712a`；审查 `git diff <基线>` 与新增任务文档、`scripts/manual/166-*`。当前 HEAD 等于基线，代码在未提交工作区，用户未授权创建审查提交。

依据为本任务 brief/spec、用户 CI 和归属约束、AGENTS.md、架构/协议/工程规则。按 code-review 技能启动相互独立的 Standards 和 Spec 两个子审查；规格来源已由当前任务提供，不需要另建 issue-tracker 配置。

## Standards

首次发现 2 项测试资源边界问题，生产实现未发现实质规范违反。

1. 手动 CLI 测试超时仅发信号，缺少最后有限退出确认。已改为使用既有 `terminateFixtureProcess`，依次回收登记的所属 Provider、worker、CLI，每个 PID 独立有界确认；退出等待不得永久挂起，失败明确报告 incomplete/PID。
2. 注入清理失败后，Playboard 故意保留所属 socket 目录，测试 disposer 未回收。已增加专项 mock，真实 Kernel close 完成后记录本次端点目录，再注入故障；测试确认所属进程退出后按精确路径删除，不扫描其他实例。

复查额外指出真实验收超时后仅 leader 退出不能证明全部后代退出。已修为只有 completed、退出 0、回执核对全部通过才删除测试目录；失败或超时保留目录并报告未确认。真实验收本次两模式均成功，无超时。

## Spec

首次发现 1 项验收覆盖缺口：自动响应写入失败、过期/失效，以及写入期间取消缺少确定性证据。

已复用 `codexAppServerFixture({holdResponseWrites:true})`，canonical/native 分别确认自动响应已写入队列、写入回调仍持有且未 resolved，再注入 stdin error、600000ms fake timer 过期、abort。断言无 completed、交互失效/过期及模拟进程终止。另补实际显式 cwd/Context workspace、目录冲突、preset 和输入快照验收。

复查确认 Spec 轴无未解决发现。该屏障专项使用模拟子进程，不将其 exitCode 断言描述为真实 OS 进程回收；真实进程回收由 CLI 集成专项独立验证。

## 结论

当前已知发现均已处置。未增加 workflow、job、matrix、自动触发条件或默认专项入口。真实 Windows 及仓库外宿主集成未验，属于独立证据边界，不由本地审查替代。最终命令和结果见[验证记录](validation.md)。

## 交付同步核对

用户授权提交 PR 后同步到 `42102c60103a9b18166c499b0c74a23e0d2295c6`。生产实现、协议生成产物和原有测试相对同步前已审查文件无差异；核对三处文档冲突仅保留主线结构并迁移新增说明，没有覆盖主线 Kernel 配置快照修复。复验结果见验证记录的“最新主线交付复验”。
