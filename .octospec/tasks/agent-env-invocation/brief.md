---
type: Task
title: agentEnv 与可定位中断
description: 将业务输入和执行环境分离，以单次调用身份中断，保留执行信封。
tags: [architecture, context, session, lifecycle, protocol, review]
---

# 目标与授权

承接 Issue 328。用户已确认开始实施，允许破坏 SDK/IPC；仅保持执行信封的 schema/items 和 namespace/name/payload 格式。两个现有独立 worktree 继续实施，不提交、推送、发布。

## 承重合同

- `KernelClient.invoke(inputs, sessionId, providerSession, agentEnv)` 平铺四个参数；不接受旧外层请求对象或 signal。返回可异步迭代的句柄，立即提供 invocationId/runId/sessionId。
- 普通 inputs 为文本/图片 parts；高级输入包含 parts 和显式恢复材料、追踪身份/代次。不得含 Context 或执行设置。保留 Gateway 的历史恢复与代次隔离，不用 agentEnv 偷渡业务历史。
- agentEnv 是可复用的执行信封配置；cwd、Adapter、model/effort、env、MCP、审批、limits 和受信指令归此参数。每次调用冻结快照；不改变传入对象。
- IPC v2 的 InvokeInput 使用 agentEnv；旧 contexts 或顶层执行配置拒绝。Run/Context 信封版本不变。
- Runtime 不渲染或自动追加业务 Context。Gateway 自行将材料/history/extra.im 转成 inputs；格式只是 Gateway 惯例，env/凭据不得进入模型正文。
- `KernelClient.interrupt(invocationId, reason?)` 仅控制本 client 的单次调用。未提交时阻止发送；已提交但无 ACK 时等原身份确认；已接纳后沿 Core/Adapter 内部 AbortSignal 对接原生取消。取消受理、执行终态和资源清理分别确认。
- 保持断流只续读、ACK 丢失只查询、未知结果禁止自动重放、client 所有权隔离和有界 drain。关闭观察不隐式取消。
- 文档表格说明 sessionId、invocationId、runId、providerSession、stream_id、seq、kernel_instance_id 及代次：含义、生成方、保存方、生命周期与用途。

## 计划与可执行性

规划评分 **96/100**：边界和调用链 25/25（已定位 protocol/client/Core/Kernel/Gateway）；迁移面 24/25（源码和测试调用点已检索）；生命周期 24/25（沿用有界 registry、ACK 恢复和 Adapter 取消链）；验证 23/25（包外真实 tgz、类型、回归和变异测试可运行；真实 Provider/跨平台服务本次不承诺）。此分数是实施准备评估，**不是验证结果**。

1. 协议与执行：独立 agentEnv，更新 schema/生成类型，删除 Core 业务渲染。
2. Client：平铺入口、同步句柄身份、interrupt 及提交前竞争处理；保留低层提交/订阅。
3. Gateway：本地拼装业务输入、迁移取消和恢复调用；独立 npm 消费。
4. 文档、规则及调用者/测试迁移；构建、针对性与回归测试、真实包外消费。
5. 按用户指定两个审查技能进行 Standards/Spec 独立审查和五轴检查；修复后复验，记录真实缺口。

## 验收

执行环境不成为模型正文；inputs 原样传递且不强制业务命名空间；调用后修改输入不改变已冻结运行。中断覆盖未开始、接纳前、运行中、ACK 未知、终态与其他 client。Gateway 正常/恢复材料和图片保持；凭据隔离；CLI/npm 包仍可用。旧 API 明确不兼容；新例子可类型检查。所有实际测试结果另记 validation。

## 范围外

不修改 Provider 原生协议，不新增跨网络认证、业务历史数据库、插件框架或持久执行；不安装/停止用户现有系统服务。

## 2026-11-08 追加交付授权

用户明确要求 Runtime 提交 PR 并合并进入 main。本次授权替代前文“未授权提交/推送/PR”的执行范围限制；允许提交、推送、创建 PR 和在仓库既有合并条件满足后合并。Gateway 仓库不在此次提交范围内；不发布 npm/tag，不修改分支保护或代替其他人批准。

## PR 329 评审修正

继续已授权交付：修复 AsyncQuestionReply 取消在 ACK 前误报成功的问题，以 submitting 抢占、ACK 后确认、未知结果禁止重放，并保留并发观察到的源流事实。对称修正中英文 MCP 指南：普通 invoke 的环境只通过 agentEnv/envs；低层执行覆盖独立说明，不恢复第五参数或兼容包装。验收覆盖取消在途竞争、ACK 丢失与恢复、已失效交互，以及公开四参数经 Kernel 到子进程的环境传递和旧形状拒绝。规划维持 96/100，实际验证另记。

Codex native ID 累计上限与去重在固定主线基线已存在，本 PR 仅修改该文件一行注释；保留原始 ID 防迟到回复误配合同，不混入生命周期重设计。

## 用户确认：执行配置与异步续跑身份分离

用户明确拒绝对整个 agentEnv 签名并要求跨轮一致，要求将条件约束写入 docs 和架构文档。agentEnv 是每次调用的配置，冻结只作用于该次调用；它不是会话身份。活动执行的回答定位原 RunRef；确认完成后的新执行由宿主通过 continuation 显式选择配置并授权。SDK 仅执行文档列明的会话/代次校验和原 Provider 会话恢复，不推断环境变化的业务含义。

providerEpoch 继续可选，由宿主在其认定的 Provider 绑定替换时维护，不要求每次配置调整递增。省略不代表绑定不变，也不提供自动检测；宿主须自己防止旧表单跨 Provider 身份域投递。不能确定续跑目标或授权时，宿主应拒绝 continuation。范围仅为现行合同澄清、示例注释、审查记录；不添加签名、字段、兼容层或改变执行实现。

规划评分 **96/100**：责任边界与授权 25/25、当前代码路径核对 25/25、双语及规则覆盖 24/25、文档验证与独立审查 22/25。外部应用未逐一验收，评分不是运行保证。
