---
type: Journal
title: Issue 265 Codex 异步问题实现
description: 保留结构化问题及身份，以活动轮次 steer 回答，区分 Provider 接纳与模型消费。
tags: [protocol, interaction, adapter, testing]
---

# 结果

用户在 PR #280 后明确修订：async ask 是可选会话补充，活动时 steer，正常完成后同题新 AgentRun。新版 brief.md 替换旧终态失效合同，旧规格存为 brief-v1.md。公共 AsyncQuestionReply 复用原 KernelClient.invoke，宿主保存问题/状态及会话资格；Adapter 正常完成只释放未答旁路，默认无期限，未知 steer 不改投。requireResume 阻止换 Provider 会话，async final_answer 不触发收尾 timer。Standards 1 项 P2、Spec 2 项 P2 均修复，静态复核无开放发现；最新验证见 validation.md 顶部。Gateway 仍忽略 async，不扩大 CI，不合并。

以下为首版历史交付：

本次修订交付前再合并 main@28c3ffa2，保留配置快照与自动审批两份新合同，重跑本任务 49 项、主线相关 24 项和全量 Node 2389 项通过；独立双轴合并复核各 0 新发现。该段为最新修订补记，后文仅为首版历史。

PR 阶段用户追加 Gateway 忽略 async 表单、不暂停的要求，并授权提交推送和创建 PR。同步 main `4a0f53b5` 后在 ImTask 入口过滤成对异步交互，正文照常；新增两种同步等待状态专项。新一轮 Standards 0 项、Spec 2 项 P2，修复 Core 晚答错误码与公开表单对象共享问题，定向 107 项通过；知识检查随主线修复后全部通过。最终结果及交付引用见任务验证和 Loop 评论；不自动合并。

以下为原实施阶段记录：

用户授权实施[规格](../../tasks/265-codex-async-questions/brief.md)后，完成公共问题合同、Codex 有界批次状态、单次 turn/steer、Provider 确认及 Core 非阻塞语义。晚填失效、取消只关闭表单、未知结果不重投；同步问答与审批保持。

真实 Codex 0.164.0 Default 的选项/自定义答案均由公开 Kernel API 完成，分别验证接纳与模型消费。最终手动专项 31 通过；完整默认回归 Node 2389 通过、91 跳过，WebUI 35 通过。默认套件采用同一 Node 的隔离安装目录，避免本机 octo-cli 安装破坏旧测试的“未安装”假设。Go/Python 各 434 项权威 fixture 及新增字符串专项通过。

Standards/Spec 初轮各 3 项 P2，修复并复核后各 0 开放发现。完整命令、环境差异、知识 lint 基线 4 项缺失及宿主 UI 未验边界见[验证](../../tasks/265-codex-async-questions/validation.md)与[审查](../../tasks/265-codex-async-questions/review.md)。新专项只显式手动运行，没有扩大 CI。代码未提交、未推送，Work App 接入及子模块升级仍在宿主边界。
