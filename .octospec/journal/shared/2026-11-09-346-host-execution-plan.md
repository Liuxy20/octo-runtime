---
type: Journal
title: Issue 346：宿主执行依赖规划
description: 记录最新 main 独立 worktree 的架构原则、metadata 复用结论和规划验收边界。
tags: [architecture, adapter, metadata, planning]
---

# 结论

用户要求从最新 main 新建 worktree，主要开启 OctoSpec，核对 Adapter 改动与 metadata 复用，规划可执行性严格超过 95 分。成功 fetch 后以 `bf665881` 建立 `plan/issue-346-host-execution`，仅编写规则与规划。

metadata 继续描述执行合同，probe 描述实际绑定状态；实际依赖复用具体工厂、CommandSpec、Codex provider 与 ACP client factory。静态 metadata 可供 CLI 的 unavailable 包装复用，不能承载 executable 选择、owner 或 close。宿主选择涵盖 Windows shim/Node、probe 与恢复；逐轮工具 PATH 和协议配置仍保留。

源码审计覆盖全部内置 Adapter 入口及关键底层启动器；[设计](../../tasks/346-host-execution/design.md)给出逐模块改动，[计划](../../tasks/346-host-execution/plan.md)给出 M0-M4 与 A01-A15。[规划自评](../../tasks/346-host-execution/assessment.md)为 96/100，四分缺口是 ACP 类型原型、原生 Windows、主线/#343 整合和真实/包外验证。实际检查与未验边界见[验证记录](../../tasks/346-host-execution/validation.md)。

后续用户授权完成 spec 后实施并 code review，明确不需要兼容层，CLI 发现 executable，要求从最新 main rebase 继续。已 rebase 至 c7ae0256（#345），保留单个共享 Codex app-server；删除各内置命令 Adapter 的默认实例和默认裸命令，CLI 装配静态 metadata 与 unavailable 状态，最终 transport 只执行固定路径。

独立双轴审查发现并关闭 Node/shebang、probe 假可用、失败目标/errno、Core 无资源清理及脚本导入问题。真实 OpenCode ACP 暴露既有 provider_diagnostic severity 与协议不一致，修正为 warning 并补显式专项校验。当前全量 1455 通过/61 跳过，专项 65 通过；真实 Codex 三轮及 OpenCode JSON/ACP 均完成清理。发行包离线安装、类型、SDK、CLI 验证通过。精确命令和未验平台见 validation。未扩大 CI，未创建提交、推送或 PR。

2026-11-10 用户追加授权英文提交、推送及创建 main PR，禁止自动合并；重新 fetch 确认主线仍为 c7ae0256，CI 范围无差异。本次仅继续交付，不扩大运行或平台通过声明。

PR #347 反馈后修复 Windows 旧 probe 调用与 actmode 默认导入，区分 optional --version 失败和实际 spawn 系统错误。用户明确 OpenCode 升级不应影响 Runtime，最终删除其版本准入和 invoke 前版本检查，版本只作诊断；不通过兼容层接受旧接口。回写 architecture、design 与双语指南，删除旧 V1 拒绝验收脚本。

本轮全量 1455 通过、61 跳过、0 失败，定向/手动 85 通过、3 原生 Windows 跳过；真实 OpenCode JSON/ACP 两路完成且清理完整。两轴独立复核均无剩余 finding；前次把版本查询失败视为不可用的判断已撤销。精确命令、SHA 范围和远端复验见 validation，不扩大 CI 或自动合并。
