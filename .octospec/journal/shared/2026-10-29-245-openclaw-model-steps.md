---
type: Journal
title: Issue 245 OpenClaw 步骤映射验证
description: 记录轮次塌缩、持久消息关联、工具归属与 Playboard 验证边界。
tags: [openclaw, protocol, testing]
---

# 结论

OpenClaw 一个 run 内会有多次模型调用；旧 adapter 将 run 当成一个 step，并丢弃已订阅的 session.message，导致卡片都归第一轮。新实现用已核对身份的 assistant 完成消息结束当前步，用后续模型输出开启下一步；工具使用调用内 ID 映射保留原 step。真实 2026.9.4 的中间 run 身份位于 `message.__openclaw.runId`，不能只检查顶层。

MC 前两条原生 thinking 本身包含 HTML，用户明确接受。没有证据证明这些 HTML 是工具增量误分类；真正的工具参数、tool 输出及 command_output 仍保留工具事件。源码/确定性回放/真实 Playboard 三层结果与限制见 [验收记录](../../tasks/245-openclaw-model-steps/validation.md)，规范见 [OpenClaw 规则](../../rules/openclaw.md#模型轮次与工具归属)。

专项位于手动目录，GitHub CI 和默认测试范围保持。审查完成时未安装到用户常驻 Runtime，也未提交/推送；实际 IM 卡片交由用户本地验收。

按用户澄清，过程正文不进 IM finalMsg；Adapter 成功收尾仅发一份最终回答，优先原生最终可见正文，保留显式空值，兼容可选 phase。7.1 到最新正式 10.8 共 31 标签固定准入/请求校验，96 项手动专项通过；7.1/10.8 新建与续聊、9.4 新建真实 Playboard 均为 3 轮、2 工具、1 条精确 final。两轴代码审查未留可复现问题；旧版续聊缺 run 身份的 thinking-only/length 边界如实保留，不按到达时间认领。

后续用户授权 build/install -g，已构建当前分支 tgz 并离线全局安装，核对 OpenClaw adapter 产物哈希一致。在无活动任务时重启 Kernel 与 Channel Gateway，两个服务及 worker ready、6 个 bot 在线。保留原配置和服务定义，人工卡片验收待用户执行，详见[安装记录](../../tasks/245-openclaw-model-steps/validation.md#用户本地验收安装)。

用户真实 hello/world 验收确认最终正文符合预期；卡片编辑 HTTP 400 用户明确由其他 PR 处理，本特性不扩范围。随后按用户授权等待 #244 合并，已将特性 rebase 到最新 main `01d0ca5`，保留双方索引与 #243 TODO。重基后类型/构建/静态检查通过，96 项专项、198 项既有回归通过（1 项既有条件跳过），本机 9.4 Playboard 再次严格 3 轮、2 工具、单一精确 final。两轴复审代码问题 0，文档历史状态已同步；交付阶段不额外安装或重启服务，继续按新 PR 当前 head 两票及既有检查条件合并。
