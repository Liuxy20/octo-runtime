---
type: Task
title: Issue 75 CLI 独立服务与启动诊断
description: 修复默认安装启动、组件状态、子命令帮助及独立自启，并记录本机证据。
tags: [cli, lifecycle, installation, testing]
timestamp: 2026-10-21T00:00:00Z
---

# 目标与范围

基线 main@0c1d1c99c90a85c715212de6e55858a41924f058，分支 fix/75-cli-lifecycle。
对应 GitHub Issue #75。用户要求建立独立 worktree、执行 octospec 流程并真机验证；补充要求 Kernel 与 Extra 各自自启，不依赖启动先后顺序。

业务目标：普通用户能看懂安装、启动、状态与失败，裸组件命令解释用途并返回帮助。决定权归 CLI 宿主和用户；显式输入为组件名称、Home、profile、manifest、自启开关及 Extra 完整声明。SDK 不继承 CLI 策略。根 README 按用户要求使用英文，提供产品介绍、npm 安装、配置、启动和核心 IPC 架构图；Loop Daemon 标注为仓外业务集成，不冒充内置命令。

拓扑：原生用户服务管理器分别启动 CLI 的 executor-kernel run 和各 Extra run；各入口直接构造共同 SDK 服务。Kernel 只拥有内部执行 worker；Extra 仅连接 Kernel，不能拉起或关闭它。配置的 Extra 独立启停、自启、状态查询，任一启动顺序均可，Kernel 后续恢复不重启 Extra。

合同内动作：帮助和参数校验、紧凑文本与显式 JSON、保留受控错误原因、原生安装与手动进程操作、自启配置、只读 IPC 查询、有界等待和清理。
越界动作：不重写业务连接逻辑、不替用户安装或启用其他组件、不重置 Home/身份/凭据、不修改正在使用的默认实例、不发布 npm。用户验收后已授权提交、推送、创建 PR 并合并 main。
公共服务 API 和执行协议不变；CLI 面向普通用户，install 默认注册并启用本组件自启，首次和重复安装相同，只有显式 --autostart=false 才禁用。cross-service 沿用原有启用/禁用语义，仅修复真机确认的 macOS 状态解析与卸载竞态；不迁移 plist 目录，不改造 Windows 触发器，无旧服务 launcher 或兼容 API 新增。此合同按用户补充的“install 就默认开机自启”修订，替代此前首次不自启的假设。

用户后续明确 start 未安装时应自动安装，且须打印额外进度日志；据此在 CLI 层复用现有 backend.install，不改公共服务后端语义。用户另外授权将候选 CLI link 到全局供试用，当前全局命令指向本 worktree 的构建产物；真机验证仍使用隔离 Home，不重启默认业务实例。

# 实施与验收

PR #80 评审整改：先 rebase 最新 main@43cdee7，保留双语开发文档及根 README 复用发行策略，再处理并发部署、前台终态诊断及原生停止/删除失败。决定权仍属于各组件宿主；不更改 SDK 自启或业务投递合同。cross-service 除此前 launchd 修复外，本轮按评审补齐 systemd/Windows 的真实命令失败传播及停止确认，不调整其自启触发器或引入新服务实现。

- [x] 所有修改服务的组件命令共用 setup lock，包含就绪等待和最终状态确认；并发请求返回可诊断忙状态。
- [x] initialize 失败、ready 后意外关闭及 closed 拒绝只处理一次，移除 signal 监听、记录和输出受控错误，清理失败仍返回非零。
- [x] 旧 manager 退出码不推定本次 start/restart 失败；当前日志失败或就绪预算负责决定结果。
- [x] systemd/Windows 停止、删除失败不报成功；仅原生明确不存在可忽略，旧实例未停止不删除定义或启动替换。
- [x] 更新 main 新增双语 CLI 文档的默认自启说明，已完成定向/全量及隔离 macOS 验证；提交后的实际发行包检查另行记录。

- [x] Gateway cardDeliveries / Gateway 与 WeCom deliveries 仅返回现有回执总数，不输出明细；原有 512 条缓存及投递机制保持不变。
- [x] start/restart 成功后包含同组件 status 的文本与 JSON 数据，并验证 Kernel Worker 与 Extra 业务状态。
- [x] start 未安装时自动安装当前组件并开启自启，输出 stderr 阶段日志；安装失败不启动，--json 保持可解析，已安装保留设置。
- [x] 各组件帮助说明用途、配置与启动入口；根 README 英文介绍、安装/配置/启动及 Kernel/Gateway/外部 Loop Daemon 的 IPC 架构图。
- [x] 裸组件、--help、本地无副作用，非法命令提示可用帮助。
- [x] aggregate/component status：未安装、停止、ready、失败；区分原生进程、IPC、worker、Extra/Kernel 可用性；文本默认紧凑，--json 保留结构化数据。
- [x] install 默认自启 true，首次/重复安装均如此；显式 false 关闭，再次普通 install 恢复；start/restart 可用，stop/start 保留已安装设置；显式禁用仍返回 SERVICE_DISABLED。
- [x] 各已配置 Extra 使用独立服务，不由 Kernel 代管；支持两种启动顺序和 Kernel 重新上线。
- [x] 失败含组件/动作/结构化错误码、受控 cause 和日志位置；不输出凭据或任意配置正文。
- [x] CLI 与真实 backend 边界回归、类型/lint、全仓测试、发行包安装验证。
- [x] 本机 macOS launchd：先复现全局旧版本；隔离 Home 安装/启停/重启/自启切换/双顺序验证；清理本次服务，保留默认业务实例，后按用户授权将候选版 link 到全局。

原生 Windows/Linux 与真实登录/重启系统的自动激活不能用 macOS/fixture 冒充，单独记录限制。

实施、原生竞态发现与验证结果见[本轮记录](../../journal/shared/2026-10-21-cli-lifecycle.md)。用户验收后已解除全局链接，开始执行授权的提交、PR 与 main 合并流程；合并遵守仓库检查与审批要求，不发布 npm。
