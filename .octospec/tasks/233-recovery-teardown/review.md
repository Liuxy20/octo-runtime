---
type: Review
title: Issue 233 第二版双轴审查
description: 记录独立 Kernel 依赖测试实现的规范与规格审查、修正和观察限制。
tags: [testing, lifecycle, architecture]
---

# 审查范围

固定点 `7fd022cd725030317feee75d27621fa6b4d996e6`；无新增提交，比较工作区 diff 并读取全部未跟踪实现文件。依据 [v2 规格](brief.md)、AGENTS、CONTRIBUTING 及 architecture/engineering/extras 规则，由 code-review 技能的两个独立审查者分别核对；实际测试结果见[验证](validation.md)。

## Standards

初审发现 Windows 下 SIGTERM 不执行 SDK 原生 close，可能丢失清理结果和 worker 回收。修正为 K/G 宿主的 IPC native-close，7 秒共用发送及退出预算，超时才强杀；没有增加 Windows skip。另将 SDK 返回值校验与独立探针收尾分开，前者失败后仍运行后者的 finally，关闭探针客户端。

进一步区分进程 exit 与管道 close，完整输出后再验收 native close 结果；管道未关闭明确 incomplete。新增 native-close 回调超时、exit 无 close 两项确定性覆盖。

复核后未发现剩余规范违反或值得单列的代码气味；CI 配置、默认脚本和锁文件 diff 为空。未实测 Windows。

## Spec

未发现需修复的问题。外部依赖装配、Gateway 只借用 endpoint、独立在途调用和新 RPC、真实 7 秒超时与进程退出、原始错误聚合以及手动专项隔离均符合新版规格。

观察限制：CLI 只公开聚合退出码 5，不能据此区分 runs 和日志问题，也不能宣称原生资源分类全部完整。规格与验证记录明确此边界；SDK 精确只允许对应 lost 的 runs incomplete，其他资源错误仍失败。

最终发现数量：Standards 0，Spec 0。上述复核对应未提交代码，不代表托管 CI 或其他平台验证。

## 最新主线复核

用户授权提交 PR 后，已 rebase `origin/main@42102c60103a9b18166c499b0c74a23e0d2295c6`，实现提交 `8baba8d2acc200d44bcd9a361437dc05d1581c28`。只有 log.md 文本冲突，保留双方记录，测试源码未变。

两轴重新审查 `42102c60...8baba8d2`，均 0 发现。主线配置快照统一在接纳前解析；本 fixture 未注入 configurations/adapterConfigurations，仍使用未配置分支，不影响 fake Adapter、RPC 身份与 worker loss。CI/default scripts/锁文件 diff 为空，配置的 Git 作者和英文提交、Codex trailer 保留。CLI 聚合退出码的观察限制继续成立。
