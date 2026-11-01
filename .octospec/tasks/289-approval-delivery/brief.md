---
type: Task
title: Issue 289：Codex 人工审批额度与响应投递分离
description: 在最新 main 基线上实现人工审批 256 条、自动响应有界队列、stdin 背压及准确失败归因。
tags: [adapter, interaction, protocol, stream, testing]
status: implemented
issue: https://github.com/Mininglamp-OSS/octo-runtime/issues/289
baseline: 148d737d3ee14f0453ae5018c563b08d6b21ec5b
---

# 目标与授权

P0：正常并发工具调用不应因为自动审批的响应尚未写回而触发人工审批数量限制。人工审批最多允许 256 条等待决定；自动批准及已经取得人工决定的请求进入独立、有界的响应投递流程。容量、传输与超时错误保留真实原因，不受插件目录的 `401 Unauthorized` 日志干扰。

先前已完成最新上游基线、独立 worktree 和 OctoSpec 计划。用户随后明确授权「开始实施 & code-review & 提交PR」，本轮据此实施、验证、审查、提交并创建 PR；不合并。工作分支为 `codex/289-approval-delivery-plan`；后续实施以[实施计划](plan.md)和[验收矩阵](validation.md)为入口。

基线为 `origin/main@148d737d3ee14f0453ae5018c563b08d6b21ec5b`，提交于 2026-11-01 15:29:59 +08:00。首次建树后又快进了一次；新增提交仅修改 Harness 文档和其知识记录，相关审批源码与首次检查的 `3f2a810b` 相同。固定继承 `octo-spec@1.2.0`，规则清单及优先级见 [context.yaml](context.yaml)。

## 已核实的问题

- `CodexAppServerClient.#handleServerRequest` 在自动审批之前检查 `#interactions.size >= 16`；自动审批条目等 stdin 写回调后才删除。因此 16 是未完成交互数量，不能解释为允许并行运行 16 个工具。
- `#write` 忽略 `stdin.write()` 的布尔返回值；响应没有专属有界发送调度和持续阻塞期限。
- `APPROVAL_PENDING_LIMIT_EXCEEDED` 目前只是 Error 的 message，没有结构化 code。canonical 失败会追加 Codex stderr，中央分类器再匹配 `unauthorized`，可能错误分类为模型凭据无效。
- native 的 `HOST_EXECUTION_FAILED` 目前不携带这类结构化失败；公共校验器仅允许流容量错误携带 `failure`。仅修 Adapter 或分类器无法完成两种输出模式的合同。
- #288/#289 记录了历史两次失败时各有 16 条尚未 resolved 的 full_access 自动审批。历史运行产物摘要未核实，不将历史日志视为当前基线的复现通过。

## 产品意图与责任检查

| 问题 | 本次决定 |
| --- | --- |
| 为什么需要 | 业务 Agent 合法并发查询会使适配器内部审批记录短时积压；基础设施应正确处理该协议流量。 |
| 谁决定 | 宿主选择 approvalMode；Runtime 负责额度、审批响应、背压、取消与真实失败；Provider 负责实际命令执行。 |
| 显式输入 | 沿用 ask / assisted / full_access、原调用身份和动态 MCP 配置，不从命令内容推断授权。 |
| 合同内动作 | 对合法请求分类、申请人工额度、接受一次决定、有界投递、确认本地写入和失效清理。 |
| 越界动作 | 限制业务查询批量、改提示词规避并发、自动回答问题、修改凭据、改变 Provider 审批策略。 |
| 对其他接入方 | Codex 的 CLI/SDK 共用修复；其他 Provider 额度、IM 自有交互限制及宿主产品策略不随本任务修改。 |

## 关键合同

1. 人工额度仅计 `kind=approval && state=awaiting_decision`，每 invocation 最多 256；第 257 条得到明确容量拒绝，不由 Runtime 单因人工额度满而终止整轮。
2. full_access 只自动处理现有支持的命令/文件审批。问题、elicitation、未知方法及权限范围升级仍遵守既有校验。
3. 决定接受、排队、写入中、本地写入完成、工具执行完成是不同事实。有效决定进入投递状态后释放人工额度，重复回答仍拒绝。
4. 同一子进程 stdin 只有一个发送所有者，普通 RPC 和审批回复共同遵守背压；stdout 持续读取。资源按条数、UTF-8 字节和时间共同约束。
5. native 原生 payload 保真，canonical 保留审计事件，`responseRequired=false` 不表示批准已投递。resolved 只在写回调成功且交互仍有效时出现。
6. 取消/终态后不得将队列中的批准继续发给 Provider；无法撤回已交给 Writable 的字节，必须保留该限制。取消、异常和关闭只清理本 invocation。
7. 结构化错误优先于无关 stderr；真实模型认证失败仍保留原分类。公共协议仅做已有可选 failure 的受限接线，不添加产品配置或改变协议版本。
8. 不新增 GitHub CI 范围；所有新增专项测试均放在默认 glob 之外并显式执行。

## 范围外

Work App 源码及其 Runtime 子模块、业务 CLI/查询并发、其他 Provider 的审批桥、IM 渠道 64 条交互额度、插件安装/登录修复、全局凭据及 Home/profile/SQLite、切换到 Codex `never`、改变动态 MCP 合同、无限队列、全局工具调度、持久审批恢复。

上游合入 main 后再由 Work App 更新子模块并验证宿主；本 worktree 不作为私有 Runtime 补丁交付。

## 验收与准备度

实施完成需通过 [validation.md](validation.md) 中 A01–A16，保留实际源码 SHA、Provider 版本、终态及清理结果。实际执行结果和未覆盖边界记录在验收文档中，不能用计划准备度代替测试证据。

计划准备度 **96/100**，是基于源码和合同的主观评估，不是成功概率或测试通过率。剩余 4 分对应真实 Provider 拒收/突发行为、实际队列预算与跨平台时序的实施后证据，详见 [plan.md](plan.md#准备度与剩余缺口)。

## 交付基线更新

创建 PR 期间主线合入 #280；交付已对齐 `dc14c094`。旁路问题与同步问题共享原 16 条独立预算，不计入人工审批 256；异步答案仍等待 Provider RPC ACK，普通审批仍在本地写回调成功时 resolved。两种确认边界分别保留，不因共用发送器混淆。
