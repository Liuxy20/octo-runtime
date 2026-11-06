---
type: Review
title: "Issue 155：本地实现自审"
description: "按行为正确性和协议/所有权两条轴检查图片输入与草稿修复。"
tags: [webui, multimodal, review, invoke]
timestamp: 2026-11-05T10:45:00Z
---

# 审查结论

本任务作者自审；没有委派独立 reviewer，不将自审当作外部审批。修复范围符合 [brief](brief.md)，最终验证事实见 [validation](validation.md)。

## 行为正确性

- 图片上限和 MIME 单一来源在 protocol 浏览器安全模块；Node 原出口保持。Node 完整性校验仍检查规范 base64、字节数和摘要，图片头函数替换前后语义一致。浏览器 build 与独立 browser bundling 验证无 Node 内置依赖。
- 每批读图先检查已有附件，读取后再检查当前集合，串行队列防止两个旧 render 快照同时突破数量限制；整批失败不提交部分结果。发送期间读取未完时不提交半份输入。
- 发送锁在首次 await 前设置；冻结文本、附件、配置、原会话及显示代次。HTTP 200 之前不清空、不虚构 ACK、不 checkpoint 乐观消息；拒绝后没有幽灵消息。200 后出错保留原执行投影，不恢复为未发送、不自动重放。
- 只移除发送快照中的附件 ID；有后续编辑则保留当前文本。切换后不夺取新会话，不向另一草稿恢复旧输入。新会话受理后在同一显示代次内迁移草稿 key。
- 文本版本独立于附件增删；等待期间只增加新图片时保留新图，但正常清空未再编辑的已发送文本，避免将其留成下一轮草稿。
- 自审补充修复：sessionStorage 写入失败时，必须先绑定新会话的内存草稿，不能继续使用旧会话输入。实际 App 专项覆盖失败导航后发送及切回原草稿。
- 自审补充修复：HTTP 响应前切走又切回原会话，即使显示代次已变化，也要立即投影同会话已受理的消息；不能等首条 SSE 才显示。专项以未产出首帧的真实 ReadableStream 覆盖。

## 架构与交付范围

- 业务选择仍属于 WebUI；公共输入、协议上限、Core/Kernel/Adapter 生命周期及恢复合同未扩展。
- HTTP 200 仅表示 WebUI 接纳，不冒充 Provider 成功；网络异常保留草稿但不意味着可安全自动重试。
- 图片附件在当前页面内按草稿保留；不新增跨页面持久化或 IndexedDB。sessionStorage 继续只保存文本。
- 专项配置和测试文件位于 web/manual 与 test/manual；默认选择器、package scripts、workflow/job/matrix/gates 均不修改。原 test:ui 仍只运行既有 35 项。
- 用户后续授权提交、SSH 推送和创建关联 #155 的 PR；完整门禁的失败、环境修正、基线对照与未验平台独立记录。范围外生命周期/清理失败由其他 Issue/PR 单独调查与修复，不将完整套件声明为绿色。

## 规则检查

已核对 context.yaml 中注入的 architecture、protocol-design、invoke-input、local-execution、extras、context-input、context-extensions、protocol-schema、environment、mcp、session-reset、output-protocol、engineering 与 collaboration。可复用的浏览器合同/受理边界已回写 invoke-input 规则。
