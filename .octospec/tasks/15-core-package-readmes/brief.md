---
type: Task
title: Issue 15 包导航与双语 README
description: 按真实包和源码职责整理导航，统一子包用途说明和双语入口。
tags: [documentation, architecture, adapter, extra]
timestamp: 2026-10-26T00:00:00Z
---

# 核心包双语 README

关联：Refs #15（仅关联，不关闭 issue）。

## 目标与范围

以 `origin/main@87291ca` 为源码基线，在独立 worktree 和 `codex/core-package-readmes` 分支整理核心框架包的 README。英文使用 `README.md`，中文使用同目录的 `README.zh.md`，提供双向语言链接。

范围包括 packages 导航及当前全部 25 个子包：Protocol、Adapter SDK、ACP Client、Executor Core、Executor Kernel、Host SDK、15 个具体 Adapter、3 个业务 Extra 和 cross-service。按用户后续要求补齐每包独立表格行、用途说明及双语入口。保留现有包名和职责分层；用户追加授权删除外部组件启动器，具体范围见下节。

## 追加：删除外部组件启动器

用户明确要求彻底删除 `startNativeComponent`，接入使用 CLI 或原生 SDK。检查确认 CLI 和 octo-work-app 的实际服务调用为 `createKernelService` / `createExtraService`，均未调用该启动器。

- 删除 `host-sdk/src/native.ts`、仅服务于它的 `launch.ts`、包及主发行物 `/host` 的相关导出、两份专属测试和 Go/Node fixture，清理 CI 的 Go 准备步骤及失效测试引用。
- 删除公开 `startNativeComponent`、`NativeComponentOptions`、`ComponentStartError` 和旧部署类型 `CleanupResult`；不保留兼容别名。原生服务仍使用 `ServiceCleanupResult`，不混同两种清理合同。
- CLI 仍作为宿主直接构造服务；SDK 服务仍在调用进程构造，Kernel 监督内部 worker，Extra 只管理自己的资源。删除通用外部组件启动能力不改变这些进程、资源及 composition root 的归属。
- 更新当前架构约定及接入文档；历史任务中保留该 API 的结论由新约定覆盖。
- 验收包含清理构建产物、检查源码及发行导出、架构回归、全量测试、类型检查和文档检查。

## 关键合同

- 读者先了解每个包的用途、使用者和边界，再查接入入口、生命周期及参考资料。
- packages 总导航先说明整体链路，再按公共协议、Adapter、Executor Core、Executor Kernel、Extra 业务及 Host SDK 分层；每层独立表格列出包、责任和边界，每行一个真实包，不将包内功能拆成行，不省略具体 Adapter，真实代码优先。
- 每个子包 README 开头约五句话，直接说明做什么、输入、输出、为什么需要及调用方或所有权；先用途后细节，双语含义一致。
- AgentExecutor 是唯一执行实现；Kernel 在调用进程提供 IPC，监督独立 worker 中的 Core。
- Host SDK 支持宿主装配：通用 Home、身份、端点工具与可选 Extra 生命周期；它不是另一套执行实现，纯 Core 或 Kernel 调用不要求加载 Extra。
- SDK 原生 import 模块；CLI 独立服务使用相同服务工厂。Extra 可以为空。
- 区分内部 workspace 包与主发行包公开子路径。不得把 private 包或未导出的接口写成 npm 用户可直接安装的公共入口。
- 区分调用接纳、取消回执、执行终态、业务投递和资源回收；双语示例保持一致。
- 清理旧 AdapterHost、自动业务历史持久化及未接入双模式等过时说明；不以文档修改扩大运行保证。

## 产品意图与所有权

业务目标是让 SDK 使用者和贡献者从包首页正确选型。安装、凭据、业务 Context、历史和存储仍由宿主决定；不增加默认策略、执行逻辑或模块拆分。追加删除属于公开 API 移除：外部使用该启动器的消费方须自行管理其外部程序，不能继续导入旧 API；CLI 和当前 octo-work-app 的服务构造路径不受影响。

## 验收依据

- 对照当前 package.json、public 导出及源码核实职责、依赖和示例。
- 检查双语页面互链、代码块一致、仓库内链接和 Markdown 格式。
- 构建框架包并严格类型检查 README TypeScript 示例；运行已有文档检查，记录基线问题与本轮问题。
- 运行 OKF 检查和 git diff --check，记录实际验证范围。
- 不修改 #15 状态，不使用 closes/fixes/resolves 关联；提交、推送和 PR 仍按用户授权执行。

## 本地审查与交付

用户已授权先按 verified-review 本地审查，再提交、推送、创建 PR 并合入 main。OSS 提交及 PR 使用英文，保持 Git 作者配置，附 Codex 协作 trailer。PR 只关联 #15。遵守 main 的 required checks 与审阅要求，不绕过分支保护；如合并受外部审批阻挡，明确报告实际状态。

审查覆盖包 README、根指南整合、公开 API 删除、CI 与回归检查。修正示例审批模式、失败清理、事件终态、独立 Extra 启动描述，并将旧指南中的源码 submodule 接入步骤迁移至双语 SDK 入门。验证记录见[本地审查记录](../../journal/shared/2026-10-26-package-readmes-review.md)。

PR 的 Ubuntu CI 暴露 main 已有的 systemd 测试隔离问题：宿主 unit 的弃用警告触发 stderr 空值断言。交付时修正该测试的 unit 搜索目录，保留全部正例严格校验，并增加非法 WorkingDirectory 负例；不修改生产服务实现或降低检查要求。Linux 原生结果以托管 CI 为准。
