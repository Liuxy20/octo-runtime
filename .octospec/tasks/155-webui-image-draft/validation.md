---
type: Validation
title: "Issue 155：Windows 本地验证"
description: "绑定源码基线，记录修复前反例、修复后专项、完整检查及验收边界。"
tags: [webui, multimodal, windows, testing]
timestamp: 2026-11-05T10:45:00Z
---

# 环境与来源

- 独立目录：本会话 `work/octo-runtime`；分支 `fix/155-webui-image-draft`；开始时 upstream/main 为 `81506f6a5d0c13ad3f7c1d03cf24ef1ed433e027`。clone 局部 core.autocrlf=false；不使用其它会话 checkout 或 node_modules。
- Windows 11 Enterprise 10.0.22621 / x64，普通用户，PowerShell 7.6.5；Git 2.55.0.windows.5，gh 2.103.3，Codex CLI 0.163.0。
- Node 24.19.0 / 26.13.0，pnpm 11.19.0；frozen-lockfile 独立安装及源码构建。不是已发布 npm 包验收。
- #155 开始时 OPEN、无评论、无对应 open PR；#157 对应 #319 已合并。#14 / #13 / #30 OPEN，#20 CLOSED；未修改这些 Issue。
- 对照目录 `work/baseline-81506f6` 从本任务仓库以 --no-local --no-hardlinks 克隆干净提交，依赖独立安装，不共享 node_modules；用于完整检查失败的归因。

# 修复前证据

修改 App 前，在实际 App 挂载路径得到两个通过的缺陷断言：5 张有效头 PNG 被接受/提交，HTTP 400 返回后文本和附件均清空；2 MiB+1 图片也被接受。
同基线实际 HTTP 13 项断言确认 4/5、大小、总量、格式、完整性与执行调用数。
随后在真实 in-app browser 打开首次安装生成的原始生产 bundle：5 张可解码的 32×32 PNG 被接受，实际 HTTP 返回 WEBUI_INVOKE_INVALID，草稿为空，历史留下失败气泡，受控执行端未被调用。

原始日志与截图在本会话 outputs 的 baseline-*、browser-baseline-*。

# 修复后专项

显式手动入口：

```powershell
node packages/octo-runtime-extra-webui/node_modules/vitest/vitest.mjs run --config packages/octo-runtime-extra-webui/web/manual/155-webui-image-draft.config.ts
node --test test/manual/155-webui-image-draft.test.mjs
node --test --test-concurrency=2 test/webui-extra.test.js test/webui-session-store.test.js test/adapter-multimodal.test.js
```

实际 App 覆盖 4/5 张、2 MiB/2 MiB+1、四张各 2 MiB、叠加选择/粘贴、并发添加、坏头/格式/零字节、发送前重新校验、拒绝/异常保稿、成功一次、受理后 SSE 错误/EOF/缺 body/运行失败不重放、新编辑、慢读文件和会话切换、慢创建会话、存储写失败隔离。最终结果与日志计数见本会话 outputs 汇总报告。

最终实际 App 手动专项在 Node 24/26 各 29/29 通过，包含切走再切回、尚无首条 SSE 时立即显示受理消息，以及只增新附件时仍清空已发送文本的竞态。单项 8 MiB 用例在 Node 26 的首次 5 秒测试预算超时，按该有界工作量将仅此手动用例预算设为 15 秒后重验通过；不改产品限时或默认测试配置。
实际 HTTP 13 项覆盖相同预算和格式、坏摘要与非规范 base64；拒绝调用数 0，接纳调用数 1。当前 4 × 2 MiB = 8 MiB，合法单图和张数下无法单独超总量；保留总量检查，验证等界及超界组合。

真实浏览器重载修复后的生产 bundle：5 张和 2 MiB+1 被本地拒绝，文本保留；四张各 2 MiB 成功、执行一次且清空。另一个隔离实例由受控请求占用同会话后，浏览器收到实际 HTTP 409 WEBUI_SESSION_BUSY，文本与 PNG 预览保留，无新失败气泡。后者 DOM 已保存；截图接口两次捕获失败，不伪造对应截图。

# 完整检查与环境归因

format:check、lint:names、typecheck/build 通过。全仓 lint 首次默认进程 heap OOM；4096 MiB 重试时宿主 PowerShell 发生资源错误；按原 apps/packages 全部目录分九批运行相同 ESLint，九批退出码均 0。没有修改 lint 规则或忽略目录。
默认 test:suites 的既有 UI 35 项通过；随后默认 Node 并发耗尽内存，定向回收核对过命令行的本任务测试树。以 --test-concurrency=2 运行原完整 Node 选择器：2401 项，2310 通过、12 失败、79 跳过。

失败包括默认 TEMP 的私有 ACL 前提、Windows 长短路径比较、两项 OpenClaw 启动所有权记录、provider.exe 清理 EBUSY，以及既有 Codex shim 测试的 Provider 常驻 PID 断言。原日志保留。创建仓库外唯一私有 TEMP，只授予当前账号/SYSTEM/Administrators；相关 47 项全部通过，证明 ACL/路径前提得到纠正。剩余完整复验和干净基线对照见 outputs 最终报告，不将初次结果改写成通过。

最终私有 TEMP 完整 Node 复验：2401 项，2318 通过、4 失败、79 跳过（退出 1）；既有默认 UI 35/35 通过。四项失败为 Grok cancellation 的 PROCESS_CLEANUP_TIMEOUT、两项 OpenClaw ORPHAN_CLEANUP_INCOMPLETE、Codex shim 的 PID 存活断言。后三项在干净同 SHA 基线和相同私有 TEMP 下 3/3 复现；Grok 单独在修复和干净基线均通过，原超时保留为未归因的间歇失败，不声称完整门禁绿色。默认 TEMP 对照的 12 项中，11 项在干净基线复现，provider.exe EBUSY 单独对照未复现。

最后只补充了 WebUI 同会话受理投影条件与独立文本版本；Node 24/26 App 29 项及最终 WebUI 包构建/类型检查通过。两种 Node 的 HTTP/WebUI/多模态组合各 75 项：74 通过、1 个真实图片 Provider 用例按既有 opt-in 跳过。Node 完整套件不导入此 App 文件，服务端和协议构建自完整复验以来未有行为修改。没有为四项失败扩大 #155 的产品修复范围。

用户确认在 PR 中披露范围外失败，并由其他 Issue/PR 单独处理。两项 OpenClaw 与一项 Codex shim 失败已在干净基线复现；Grok 间歇超时原因仍未确定，不能断言其根因或已修复。本次不创建这些后续 Issue/PR，不扩大 #155 修复范围。

# 验收边界

- 所有执行端证据为受控 fake execution / fake Provider；不声称真实图片 Provider、真实 Kernel-to-Provider 业务验收或线上 IM 已通过。
- 真实浏览器是 Codex in-app renderer，通过受支持 CUA/CDP 操作；不是 Windows Server 2022、Windows 10、Edge/Chrome 或 SDK 消费桌面 App 的替代证据。
- macOS/Linux、发行包安装和线上 IM 未验证；不扩大 CI 来补这些证据。
- 新图只在当前页面内保留；刷新页面后不承诺恢复未发送附件。fetch 异常不能确认远端是否已执行，保留草稿但不自动重试。
