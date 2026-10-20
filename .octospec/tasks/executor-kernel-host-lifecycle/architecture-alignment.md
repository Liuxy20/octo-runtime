---
type: Review
title: 当前架构文档对齐与差异记录
description: 区分线上架构来源核对、本地实现文档修正和历史断链处理。
tags: [architecture, documentation, review]
timestamp: 2026-10-20T00:00:00Z
status: awaiting-source-access
---

# 来源与状态

用户指定[线上架构文档](https://im.deepminer.com.cn/d/d_e34402004b642927092dd649)为对齐来源。
已执行 `octo-cli docs get d_e34402004b642927092dd649`，返回 UNAUTHORIZED；
`octo-cli auth status` 显示 active=null、profile_count=0、env_token_set=false。
尚未取得标题、正文、文档类型或版本，不能将以下本地修正宣称为线上文档对齐完成。
待本机配置可读身份后，通过 octo-cli 读取元数据及正文，记录版本，再逐项核对。

本地修正以用户已明确的 Kernel/独立 Extra/CLI 生命周期决定及当前源码为依据。

## 已发现并修正的正文差异

| 文档 | 原不一致 | 当前修正 |
| --- | --- | --- |
| ARCHITECTURE.md | daemon/AdapterHost 仍作为当前结构；Extra 和函数都在宿主进程 | Kernel → 独立 worker/AgentExecutor；Extra 独立进程，宿主函数经有界代理；保留远程接入待定标识 |
| rules/architecture.md | SDK 默认带 12 Adapter、保留旧命令、旧执行名称 | 显式 worker 入口/选择集合、旧 daemon 删除、两组六动作、唯一 Core |
| guides/workspace.md | 仍列 apps/daemon、旧包、pnpm daemon | 仅 CLI app、新 Kernel/Host SDK 依赖方向及实际构建命令 |
| guides/operations.md | createDaemonRuntime/startAccount、旧 health 字段、无效日志选项 | owned/attach/startExtra、Kernel/Extra 独立状态、CLI home/logs 与实际 SDK 日志配置 |
| skills/octo-runtime/SKILL.md | 指导运行旧 daemon、agent-run/session、--force 和旧日志路径 | 两组六动作、默认不自启、无隐式安装、attach 不拥有服务、原流订阅和真实清理事实 |
| rules/channel-integration.md | 宣称仍有 daemon module 工厂、没有渠道生命周期命令 | 仅函数式 Extra；channel-gateway 六动作；其他 Extra 由 SDK 管理 |
| rules/invoke-input.md | 关闭消费/连接含混为取消，SDK 一律 invoke | Kernel submit+subscribe 与 Core invoke 分开；关闭 attached 连接不取消；Extra.stop 只取消所属 Run |
| rules/openclaw.md、environment.md | 连接刷新归旧 daemon、已删除 --openclaw-home | CLI executor-kernel 启动刷新；使用实际环境配置来源；playboard 临时 Kernel |
| 动态 Context 与 IM invoke 指南 | 将旧同进程 SDK 验收当作当前实现；使用已删除 worker 入口名 | 标明历史证据；serveWorker 和独立进程实现另验；业务/执行责任保持 |
| 知识索引、任务记录 | 仍称“运行代码未实施” | 当前实现、通过范围与未验项分别记录，方案评分不作为完成率 |

## 9 处跨仓库失效链接

| 位置 | 数量 | 处理 |
| --- | --- | --- |
| ARCHITECTURE.md 的 octo-daemon-old 四个文件 | 4 | 保留历史调查文件名，改指本仓设备身份决策；不将缺失旧仓当作当前实现入口 |
| 连接状态机 journal 的 Work App 设置源码 | 1 | 保留历史外部源码路径，并注明当前工作区未提供 |
| remove-execution-features/delivery 的 Work App AGENTS/README | 2 | 保留历史来源名称与路径，不伪造远端源码链接 |
| sdk-host-extra-contexts 的 register-demo 两个入口 | 2 | 保留历史入口；明确新 Host SDK 迁移与真实宿主验收另记 |

历史记录的测试数量、提交、平台和旧实现事实不改写为本次结果。
当前正文中已删除的 API/包/命令不能继续作为操作指南；历史调查可以保留旧名，但必须标明时点和范围。

## 待完成的线上核对

1. 取得线上文档标题、类型、版本或更新时间和完整正文，记录实际读取结果。
2. 核对 HostApp/CLI、Kernel、worker/Core、Extra、Provider 的职责及生命周期箭头。
3. 核对两组六动作、Extra 独立所有权、attach/owned、动态依赖及本地/远程边界。
4. 对线上图中未实现的组件继续标为目标，不新增未授权的协议或业务实现。
5. 若线上文档与用户本轮明确决定不同，逐条报告冲突；不隐藏差异或擅自改写线上正文。
