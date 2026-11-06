---
type: Task
title: "Issue 155：WebUI 图片合同与草稿保留"
description: "统一图片限制，在受理前失败时保留原会话草稿，并隔离异步编辑竞态。"
tags: [webui, multimodal, invoke, stream, testing]
timestamp: 2026-11-05T10:20:00Z
upstream: https://github.com/Mininglamp-OSS/octo-runtime/issues/155
---

# 目标与背景

基于 upstream/main `81506f6a5d0c13ad3f7c1d03cf24ef1ed433e027` 独立 clone/分支修复。
WebUI 当前接受 8 张 / 5 MiB，协议限制 4 张 / 2 MiB / 总计 8 MiB；发送前清空并持久化乐观消息导致拒绝丢稿。

## 产品意图与归属

- 用户选择文本、附件、项目与 Provider；WebUI 保存并发送本轮明确输入。
- 协议拥有图片限制、格式和完整性合同；浏览器安全模块共享常量及图片头检查，不引入 Node 依赖。
- WebUI HTTP 200 SSE 表示其接纳；HTTP 拒绝或 fetch 异常前保留草稿，受理后错误展示原执行，不自动重放。
- 输入快照与原会话绑定；异步读图、并发添加、切换和新编辑不能覆盖其他输入。
- Core、Kernel、SDK、Adapter 及其他 Extra 的产品策略和执行所有权不变。

## 承重合同

InvokeInput 图片数量、大小、格式及数据完整性；接纳与终态区分；会话绑定、checkpoint、草稿和图片预览；只发送一次。

## 范围

仅修改共享浏览器安全图片合同与 WebUI composer/send；不扩协议上限、不改 Provider、不重构整个 UI、不新增默认测试或 CI 范围。
初始仅本地交付；用户后续授权验证后提交、SSH 推送并创建关联 #155 的 PR，并明确要求披露范围外失败、由其他 Issue/PR 单独处理。本 PR 只交付 #155 的图片合同与草稿修复，不直接关闭 Issue；合并后由 Closes #155 关联关闭。

## 验收

- 先记录实际 App 的 5 张、单张 2 MiB+1 与 HTTP 拒绝后丢稿反例。
- 修复后实际 App 及真实 HTTP 覆盖 4/5、2 MiB/2 MiB+1、总量、叠加选择/粘贴、有效头/数据及格式。
- 拒绝、异常、异步读取、并发添加、编辑/切换均不丢稿或污染其他会话；无幽灵消息或重复气泡。
- 正常接纳仅一次、按快照清空；受理后错误不自动重放。
- Node 24/26 手动专项与适用完整检查；真实浏览器、真实 Provider、其它 OS 分别记录，不以 fake 冒充。
