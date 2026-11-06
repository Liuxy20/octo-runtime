---
type: Journal
title: "Issue 155：浏览器图片合同与受理边界"
description: "记录共享浏览器安全合同、草稿所有权和真实浏览器反例的经验。"
tags: [webui, multimodal, octospec-learning]
timestamp: 2026-11-05T10:45:00Z
---

# 变化

WebUI 选择、粘贴和发送使用协议图片预算；读文件、发送快照及会话切换按原草稿隔离。只在 WebUI HTTP 受理后追加消息和清空已发送输入。

# 经验

协议 Node 入口可能带 node:crypto/Buffer，不能直接供浏览器引用；纯常量/图片签名应单独共享。React handler 保留 render 快照，需要同步 ref 标识实际草稿、发送锁和异步归属。读图完成后还要按当时集合复核预算。
保留草稿优先于“发送失败后恢复旧值”：后者会覆盖等待期间的新输入，也会污染切换后的会话。HTTP 接纳、Provider 成功和历史保存是不同事实；错误不能触发自动重放。

# 规则与证据

已回写 [invoke-input](../../rules/invoke-input.md)。[任务](../../tasks/155-webui-image-draft/brief.md)、[验证](../../tasks/155-webui-image-draft/validation.md)与[自审](../../tasks/155-webui-image-draft/review.md)记录本地事实。默认临时目录 ACL/短路径及全仓检查失败单独归档，不扩大修复或 CI 范围。

用户后续授权提交、SSH 推送及关联 #155 的 PR，要求在 PR 中如实披露完整回归的四项失败，并由其他 Issue/PR 单独处理。三个确定基线失败与一个未归因的 Grok 间歇超时分别记录；#155 专项通过不等于全仓门禁绿色。
