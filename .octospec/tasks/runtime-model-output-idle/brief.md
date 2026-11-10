---
type: Task
title: Runtime 模型输出静默通知
description: 在既有 canonical run.notice 和 agent_run.event 上实现源端 60 秒静默事实，不增加 native 类型或 Gateway 计时。
tags: [runtime, protocol, silence, testing]
---

# 合同与范围

用户明确同意实现 model_output_idle，复用 JSON-RPC 2.0 agent_run.event 与 canonical run.notice。native 不新增类型。Runtime 使用单调时钟记录连续 60 秒无公开模型文本输出，每个静默区间通知一次，恢复真实输出后重新计时；通知只描述事实，不请求取消、不伪造 Provider 输出。Gateway #34 本轮仅建 issue，不改其代码。

新增 code 的 payload 复用 noticeId/code/severity/params：severity=info，params.silenceMs 为达到阈值时实际毫秒数（至少 60000），message 为对应整数秒数加 `s no LLM output`。载荷严格校验，不接受未约定字段。通知使用原 Run 身份、序号、缓冲与续流。

Core 按源端 canonical assistant 文本 delta 和增长的 snapshot 观察输出，只计公开内容；空白、user/tool 文本、私有 reasoning、心跳、usage、重复 snapshot、普通活动不重置计时。工具和审批/用户输入等待、排队暂停静默区间，最后一个阻塞解除后重新开始。重叠的原生活动与 canonical 生命周期不能提前解除等待；终态、取消、异常和资源清理停止计时并清除待发通知。

每轮一个待发通知槽；等待 Provider next 时并发等通知，不并发调用 iterator.next，不因为通知丢弃真实 Provider 结果，不为每条输出累积未释放通知监听。恢复输出或进入等待会重置/暂停尚未达阈值的计时，但不撤回已经生成的静默事实；已生成通知保留到take消费，终态/取消/异常优先清理。单槽未消费时不能被后续区间覆盖；Core在同时就绪的普通源输出之前交付该事实。native 调用不实例化静默观察器、不转换原生帧。

# 与既有预算的关系

本任务不删除 limits.enforcement，也不修改 model_idle_policy、首帧/整轮/工具预算和默认值。首帧默认 60 秒或其他预算先到时，原超时/取消优先，通知不保证早于该终态。需要等待超过 60 秒的调用方应显式提供相应预算；Gateway 后续迁移在其仓库处理。原 model_silence 是看门狗进展诊断，不拿它冒充“无模型文本输出”。

# 验证

新增专项仅 test/manual：单调时钟边界、重复通知抑制、文本恢复、重叠工具/交互、迟到 timer、取消/终态、协议正反例及与 Provider next 的竞态。真实本地 Kernel/client 用受控 Adapter 等待真实 60 秒，验证通知、流身份/序号、继续执行及清理；不冒充真实模型或 Gateway 联调。全量回归、类型/格式/文档、双包与知识 lint，CI 范围保持原样。未授权提交、推送或发布。

## 后续范围更新

以上记录对应静默通知实现阶段。用户随后明确授权另行[删除 enforcement 及兼容分支](../remove-limits-enforcement/brief.md)，因此“保持 enforcement”的阶段约束不再是当前合同；model_idle_policy、有限预算及静默通知保持。
