---
type: Journal
title: Issue 40：OpenClaw 多版本兼容实施
description: 真实握手合同、旧创建参数、权限回退、审批桥与终态对账的本地实现记录。
tags: [openclaw, adapter, invocation, interaction, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 实施结果

用户明确要求开始实施后，在原独立 worktree 完成 [Issue 40 兼容代码与自动化](../../tasks/40-openclaw-compatibility/implementation.md)。未创建提交、推送或 PR，未改用户 OpenClaw Home、全局权限、Agent 或凭据。

后续用户明确接受 6.11 代表验证为本次交付验收，并授权 commit、PR 和合入 main；上段未提交为实施时点状态，当前按保护规则进入交付。未实测的版本保留其真实证据等级。

创建参数改为真实握手后按精确版本合同生成。7.x 使用公共创建字段和当前会话 full/off patch；新版保留原生权限模式。ask 在新版人工通道可用时保留，旧 reviewer 无法确认或新版人工通道缺失时按用户已授权方向回退 full，通知和审批桥同步 effective，原请求身份及 Context 保留。

统一原生终态判断，修复重复取消、过早关闭对账连接、预取消 RPC 不结算和超时监听器残留；断线只对账已有执行，不重发 agent。26 个标签分别保留源码证据，生成实际发送字段的严格请求投影；52 条 ask/full 流程及额外故障场景自动化通过。样本不是完整上游 Schema，也不代表真实 harness 执行。

最终构建／类型、lint、命名、格式、开发文档及 diff 检查通过；全量 WebUI 35 项通过，Node 1562 项通过、34 项条件跳过、0 失败。另补 ACK 前取消、取消回执与成功终态冲突和 pending lifecycle 回归；前者已发送时仍须对账，后者不提前结束模型步骤。OctoSpec checker 仍有原先的 docs 目录冲突，无新增知识错误。首次检查暴露的过期 mock、构建与 lint 并发及一处类型转换已修复，具体记录见实施文档。

真实 hello 为 2026.9.4/protocol 4：full_access 与 ask 固定文本调用成功，ask 保持 guarded；接纳后取消经一次 abort 和 agent.wait 确认为 cancelled。另有原队列脚本的 27 条原生事件验证通过。白名单[证据](../../tasks/40-openclaw-compatibility/live-gateway-evidence.json)和可复测脚本已保存；未调用工具或 IM，不改全局策略。

其余版本的真实模型、reviewer／harness、工具限制和 IM 验收仍未完成，原始事故 build／trace 未确认；不宣称全部真实版本均已支持。可复用合同已回写 [OpenClaw 规则](../../rules/openclaw.md)，支持范围及限制已更新到 Adapter README。

## 追加真实 6.11 验证

用户提供旧版私网 Gateway，并批准固定测试设备配对。真实握手确认 2026.6.11／协议 4；源码及严格请求投影核对后加入精确版本表。6.11 与 7.1 在实际发送的 create、patch、agent 三种投影上相同，当前共 27 个标签、四类投影、54 条 ask/full 流程。没有扩成未核对的连续 6.x 范围。

真实 Adapter probe 只调用 connect／agents.list，通过。full_access 和 ask 回退 full_access 的文本与指定 exec，以及接纳后取消共五个场景通过；固定 exec 命令为 printf 输出标记，断言一次调用及原生成功结果。每场景一次创建、一次 agent、唯一终态，取消一次 abort 并 wait 确认。ask 每次回退恰好一次明确通知，不新增确认。

正式入口拒绝非回环明文 ws 的规则保留，QA 经显式临时本地 TCP 转发连接用户授权实例；转发不增加 TLS，也不冒充生产 WSS 验收。测试结束关闭转发，不改全局策略或目标 Agent，不发送 IM。按用户要求将真实内网地址及配对编号从交付文档移除，凭据和私钥不入库。三份白名单 JSON、脚本用法与边界见 [6.11 验证记录](../../tasks/40-openclaw-compatibility/remote-6.11-validation.md)。

新增版本后再次完整构建／类型和 lint 通过；全部 OpenClaw 测试 92 通过、1 个 GC 条件跳过、0 失败。上文全仓数字为追加前记录，未冒充追加后的全量再验。7.1 的修复依据由源码一致性和旧版代表实例补强，但仍不标为真实 7.1 实测。

## 交付复核

用户授权交付后，将实现同步到 main `102fb9c`，保留 Issue 99 与 Issue 40 索引。工程规范复核无问题；需求复核发现原生完成后晚取消误报的 P1，修复并新增四条回归，独立复核通过。详见[评审记录](../../tasks/40-openclaw-compatibility/review.md)。

WebUI 35 通过，完整 Node 套件以并发 4 执行为 1570 通过、35 条件跳过、0 失败。默认并发两次各有一个未改动的时间敏感测试失败，定向复跑 Codex／兼容性 101 项、进程回收 11 项全部通过；不放宽断言，不隐去失败。构建／类型、lint、格式、命名及文档检查已通过；GitHub CI 与批准审查按 main 保护规则执行。

## PR #102 意见修复与扩查

原 head `c3e4f1f` 的六组托管 CI 与 CI Gate 通过，随后两位外部评审仍分别发现 pending 最终载荷丢失和取消主动关闭旧 wait 后误报失败，用户要求核对并扩查。两项均在真实本机 WebSocket 对端复现；进一步独立检查确认旧 wait 覆盖新终态、恢复时步骤结束丢失、资源溢出后错误报成功三类问题。

已统一中间回执识别及终态出口，保护并发已确认结果，恢复步骤结束并保持容量失败和清理失败事实。新增 17 条回归，全部 OpenClaw 113 通过、1 个 GC skip；外部两项和额外三类缺陷最终均复核无剩余阻断。详情见[最新评审记录](../../tasks/40-openclaw-compatibility/review.md)。此轮无额外实网模型或 IM 操作；原私网凭据和地址继续脱敏。

最终本地默认并发全仓 Node 1587 通过／35 条件跳过／0 失败，WebUI 35 通过；完整构建／类型、lint、命名、格式、开发文档及 diff 均通过。OctoSpec 只保留既有 docs 目录冲突；新 head 的远端 CI 和请求修改后的批准另行核对。
