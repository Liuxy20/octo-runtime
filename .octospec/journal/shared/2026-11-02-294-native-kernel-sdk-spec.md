---
type: Journal
title: Issue 294 原生装配与统一 RPC 规范阶段记录
description: 记录独立 worktree、已确认职责边界、文档检查及尚未实施的代码与平台验证。
tags: [architecture, adapter, ipc, documentation, validation]
---

# 范围与基线

2026-11-02，从 `origin/main@58332b3bcf5651f58e674fa236184dc6a0d927ca` 创建独立 worktree，分支 `codex/294-native-kernel-sdk-spec`。本轮交付为 [#294 简报](../../tasks/294-native-kernel-sdk/brief.md)、[计划](../../tasks/294-native-kernel-sdk/plan.md)、实际读取上下文和现行规则更新；代码、公共声明和运行示例未改。

## 固化的决定

- Electron SDK 是核心模式，CLI 为特殊宿主；两者传入自己 import/构造的 Adapter 对象。
- 模块 manifest 的读取、来源解析、动态 import 和工厂调用完全归宿主，Kernel 不接受模块清单或路径描述。
- 同进程业务也使用 KernelClient/RPC，不绕过 ExecutorKernel 的稳定性处理。Kernel 不启动执行 worker，Adapter 的合法 Provider 子进程继续按原合同管理。
- 规范中的函数签名只声明已确认的装配输入和服务返回类型，不是完整选项清单，不建立签名迁移表，也不决定其他无关选项的删除。
- 用六类职责案例与两类宿主完整流程消除装配、调用、Provider 启动和服务部署的混淆；旧 worker 机制标为待迁移基线，进程隔离不能由 RPC 替代。

规范正文集中在[基础架构](../../rules/architecture.md#sdk-原生装配与统一-rpc)，协议、生命周期、Adapter/Extra 规则和根架构讲解同步指向该合同。历史任务及其验证证据未重写。

## 本地文档验证

- `.octospec/scripts/lint.py` 通过：检查 OKF 单元、规则索引和本地文件链接。系统 `python3` 缺少 PyYAML，使用 `uv run --no-project --with pyyaml python .octospec/scripts/lint.py` 在独立工具环境完成，未修改仓库依赖。
- 对本次变更知识文件另外校验 `type/title/description/tags` 和 `context.yaml`，并核对本次新增的章节锚点。
- `git diff --check` 通过；相对 `origin/main` 的改动仅为 Markdown/YAML 文档。
- `.github`、`package.json` 和 lockfile diff 为空；未扩大 workflow、job、矩阵、触发条件、必需检查或默认测试入口。本轮无提交、推送及 PR。

## 尚未验证

新装配实现、实际 RPC 路由、进程拓扑、稳定性回归、包外 SDK、真实 Electron 打包与运行、真实 Provider 和 Windows/Linux 平台验证均为 **not run**。本轮是规范阶段，不运行构建或模型调用；文档检查通过不表示 #294 已实现。

计划自评 93/100 仅评估可执行性；状态协议、旧清理记录和环境/日志上下文的剩余设计分别占 3/2/2 分。其后续验收仍以真实实现和运行证据为准。
