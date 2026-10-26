---
type: Task
title: Issue 156 CLI 与 Extra 操作文档收敛
description: 基于 PR 191 后的 main 修正安装、自启与独立 Extra 路由说明。
tags: [documentation, extra, lifecycle]
timestamp: 2026-10-27T00:00:00Z
---

# 目标与范围

基线 `origin/main@a7c33b6`，分支 `codex/156-cli-docs`。处理 [Issue #156](https://github.com/Mininglamp-OSS/octo-runtime/issues/156)。PR #191 已修复 WebUI/WeCom 双语 README 的独立路由及 DEPLOYMENTS 的默认自启；本次补齐 Extra 指南、仓库 Skill 和双语 CLI 入门的剩余差异。

产品意图归属：CLI 用户需要正确安装和启停自己选择的组件；服务默认值归 CLI，SDK 生命周期归宿主。输入是组件名、Home、已保存且启用的 Extra 声明及显式自启选项。本次仅按现有实现修正文档，不改变默认值、不注册真实服务、不替宿主增加部署要求，也不修改 Provider/IM 行为。

# 关键合同

- WebUI、WeCom、Gateway 分别使用 webui、channel-wecom、channel-gateway 路由；SDK 保留 createExtraService 接入。
- 首次和重复 install 默认开启自启，显式 --autostart=false 禁用；普通 install 恢复开启。
- start 自动安装缺失的本组件并开启自启；已安装时保留设置。restart 不自动安装，缺失返回 3。
- 显式禁用时 start/restart 返回 SERVICE_DISABLED；先 install --autostart=true 再启动。run 无需注册服务。
- 每条命令使用相同 Home，仅控制所选组件；保存配置、服务启动及业务连通是不同事实。

# 验收

1. 逐项核对 Issue 的路由、默认值、禁用行为及证据边界；覆盖现有包 README、规则、help、部署指南及 Skill。
2. 检查新增 OKF frontmatter、索引、本地链接、Markdown 解析与双语代码块一致性；运行 git diff --check。
3. 文档修改不需要执行真实服务安装或 Provider/IM 联调，不将静态检查写成真实平台验收。
4. 按用户授权提交英文 commit/PR，关联 Closes #156；满足 reviewer approve 和 CI 后自动合并，保留 Codex trailer。

验证结果见[本轮记录](../../journal/shared/2026-10-27-156-cli-docs.md)。
