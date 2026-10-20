---
type: Task
title: Gateway 关闭收尾与 Windows 受管后代回收
description: 在纯 TypeScript/Node.js 公共层约束下修复 Gateway 收尾，明确 Windows 异常回收限制。
tags: [planning, lifecycle, channel, windows, ipc, testing]
timestamp: 2026-10-20T00:00:00Z
status: in_progress
---

# 目标与当前状态

用户要求从最新 main 新建独立 worktree，为两项 P1 建立可完成性至少 95 分的 Octospec 开发计划。
初始规划基线为 `origin/main@6f5f25f97ec4b2ca879ac78ca2990ee2019f9eeb`；提交PR前已rebase至
`origin/main@fae6333632010602506774b0648b639b70d25e22`。分支为
`feat/gateway-drain-windows-cleanup`。用户已要求关闭规划PR #68、重命名分支，并明确授权按M0–M5直接实施。
2026-10-20 用户明确公共层不引入原生实现、业务 Extra 除外。该决定取代旧 Windows Job 方案，现行范围见[架构规则](../../rules/architecture.md#实现语言与原生依赖边界)和[实施记录](implementation.md)。

本轮按用户要求再次 rebase 至 `main@e82a2f0`（PR #73），沿用统一 KernelClient，保留旧执行桥删除，迁移 drain 与相关测试。用户追加核心代码注释要求：在 AGENTS.md 设置强制入口，正文见[工程规则](../../rules/engineering.md#核心代码注释要求)；重点补齐 Kernel/Core 公开接口、接入使用、状态与资源边界的中文注释，清除旧 daemon/AdapterHost 职责描述。注释维护不增加执行策略或原生依赖。

PR72 在 `816ad54` 的后续 P2 按用户要求修复：真实 Kernel 可在订阅 ACK 时先确认终态并释放登记，而 Gateway 仍等待交互展示。drain 遇到 `INVOCATION_NOT_TRACKED` 时，仅由同次原流正常耗尽且含真实终态证明无需再取消；不能吞掉未知、丢流、控制或业务收尾失败，不增加公共 API、重放订阅或执行桥。验收覆盖真实 IPC 的终态先于订阅、延迟展示、关闭/重复关闭和唯一 final，并保留失败与共享期限合同。

1. Gateway 停止时，先停止接纳和准备，再取消所属执行，在预算内消费真实尾事件、更新当前代次 binding 并尝试最终回复，最后释放业务连接。
2. 撤除 Windows Go broker、专属构建、两架构二进制分发及公共接线。Windows 保留 Node.js 与系统 taskkill 常规清理；父进程先退、Runtime 被强杀时的强回收目标尚未达成，不能标记已修复或关闭对应 umbrella issue。

关联 #30、#14、#47、#48、#50；与 #57、#65、#66 协调接触文件，不接管会话存储工厂或公共 Extra API 重构。
索引：[设计](design.md)、[开发步骤](plan.md)、[验收](acceptance.md)、[95 分评估](assessment.md)、[阅读记录](context.yaml)。

## 已核对的问题

| 问题 | 基线源码证据 | 证据边界 |
| --- | --- | --- |
| Gateway 先断连接后收尾 | `im-channel.ts` 的 close 先 closed/abort/connector.close，事件循环和 finalReply 又检查 closed/aborted | 前一轮同 SHA 的受控探针观察到取消但最终回复次数为 0；不等于真实 IM 已复现 |
| owner abort 传播至业务资源 | manager 将 Extra signal 与自身 abort 合并传给 ImRuntime；runner 在 stopAdmission 后先 cancelOwned，再 plugins.close | 只改 connector.close 顺序不足以修复完整链路 |
| Windows 仅按活 leader 清树 | process-cleanup.ts 仅在 !exited() 时运行 taskkill /T，非进程组 exists 只检查 child 本身 | 已确认实现缺口；本轮没有 Windows 真机复现结果 |
| 调用点保护不一致 | ACP、NDJSON、Codex、ZCode 与 Host/worker 使用不同 cleanup 参数 | 仅修改 Host 的 processTree 参数不能证明 Provider 后代已回收 |

rebase后重新核对Gateway close/事件循环/finalReply，提前中断链路仍存在；新增rulesContext按session/generation/revision条件更新的合同必须保留。
初始探针仍只作为初始SHA证据，不转写为新基线的产品测试成绩。

## 关键合同

- HostApp 拥有独立组件；Kernel 只监督 worker；Gateway 管自己的准入、会话和投递。附加客户端关闭不停止共享 Kernel。
- 使用唯一 AgentExecutor、既有 Kernel IPC 和 stdio NDJSON。Run 7、Context v3、权限、审批、输入和事件身份保持不变。
- 取消 ACK、真实执行终态、进程树清空、binding 写入和最终投递是不同事实，分别检查；未知结果不得合成为成功或已取消。
- shutdown 不创建新 Run、不自动重放、不重新取 Context、不扩大工具权限，不增加 artifact 扫描或文件交付流程。
- SDK 方法、返回结构、配置 Schema 与调用方式保持不变；平台选择和内部清理由框架完成。
- 清理失败保留真实错误与所有权，阻止冲突替换；同一 stop 的重复/并发调用共享结果。清理无关资源仍须尝试。

## 架构范围检查

| 检查 | 本任务结论 |
| --- | --- |
| 真实业务目标 | 宿主停用/重载 Gateway 时，已接纳工作得到有界收尾；Windows 取消或退出不遗留本次工具后代 |
| 决定权 | Gateway 决定既有回复投影；通用执行层报告真实终态；进程资源拥有者负责 OS 回收 |
| 显式输入 | 用户已授权的组件 stop、调用 cancel、owner 断连、受管进程异常退出 |
| 合同内自动行为 | 停准入、取消所属 Run、保留原流、尝试既有 final、回收既有资源、报告不完整 |
| 禁止越界 | Kernel 管 IM、宿主调用 Runtime CLI、恢复 daemon、全机扫描杀进程、自动业务重试、重建 Home |
| 其他产品影响 | attached/ordinary caller cancel 语义不变；WeCom 仅核对同源生命周期分支，不能静默套用 Gateway 的回复策略 |

## 范围外

不实现 SQLite/存储工厂、Go 执行 IPC client、LoopDaemon、远程设备注册、Provider 新功能或 UI。
不迁移旧 daemon，不删除或重建身份、profile、凭据及用户数据。
公共层不允许使用 Go 或其他原生 launcher；业务 Extra 的原生依赖只在自身范围负责，不把公共进程管理迁入 Extra 绕过约束。

## 完成条件

Gateway 开发和测试沿用 [M0–M5](plan.md) 中的 Gateway 部分及 [G01–G10、I01–I04](acceptance.md)。旧 Windows W 矩阵及 95 分评估仅保留为已撤回方案的历史，不能作为当前完成条件或成绩。
真实接口只使用 `https://im-test.deepminer.com.cn/`；真实 Windows 10/11、真实 Provider 与 SDK 宿主的证据独立记录。
未执行、环境不可用、仅交叉编译均不能标记为平台通过。
计划评分为工程判断，不表示实现完成率或 95% 成功概率。
