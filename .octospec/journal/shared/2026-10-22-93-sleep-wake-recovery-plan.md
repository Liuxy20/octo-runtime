---
type: Journal
title: Issue 93 睡眠恢复与状态日志规划
description: 记录独立 worktree、规划合同、用户补充、证据限制和文档检查结果。
tags: [architecture, lifecycle, channel, testing]
timestamp: 2026-10-22T00:00:00Z
---

# 本轮交付

在 `origin/main@3b34415` 新建 `plan/93-sleep-wake-recovery`，路径 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-issue-93`。桌面 worktree 工具因聊天位于多个仓库父目录返回 Not a git repository；标准 git worktree 创建成功，原 main 未修改。

完成 [简报](../../tasks/93-sleep-wake-recovery/brief.md)、源码分析、恢复设计、M0-M6 计划、A01-A27 验收和 S01-S14 双模式矩阵。规划可执行性自评95分，根因和真实验收仍有明确门槛；未实施代码、未运行真实服务、未提交或推送。

用户补充将重试调整为5/10/15/15秒，并明确 `channel-gateway logs` 仅展示 Extra 工作状态。计划规定状态 stdout 与有界文件镜像，排除聊天内容、具体会话、模型和工具输出。SDK 默认静默；CLI 自己的状态输出不能污染 worker NDJSON。

# 可复用调查结论与边界

服务 running、IPC 可达、worker ready、Provider 可用、Bot WS online、Run 完成和回复投递是不同证据。Gateway 与 Kernel 两次重启只能证明恢复跨越两个边界，不能证明 socket 监听坏了。reason12 在本地 IM 源码表示踢连接且有多种触发点，必须核实部署，不能直接无限重连。

以上已是现行架构要求，本轮不改生产规则来宣称新恢复保证已经实现。新15秒退避、首次离线后台恢复及状态日志合同在实施时更新对应规则；不把未经实测的候选心跳修复写成当前能力。

# 验证

上游 OctoSpec OKF 校验通过：296 个知识文件。context YAML 解析、11条已读规则的 SHA-256 指纹、A01-A27/S01-S14 编号完整性通过。`git diff --check` 和新增文件行尾空白检查通过；原 main checkout 保持干净。

完整仓库知识 lint 仍失败，唯一输出为 `已退出的文档目录仍存在: docs`，与干净基线一致；未出现新增 frontmatter、规则索引或本地链接错误。不删除现行 docs 目录来绕过。产品构建、测试、平台睡眠/自启、真实 IM/Provider 全部未执行。

# 后续授权实施与验证

以上为规划时点记录。用户随后授权实施和分阶段英文commit，并要求核心代码英文注释、日志保留最近三份。M0-M5依次提交 `bb06a5f`、`f8f3847`、`b5e9922`、`abec846`、`994a58b`、`0265807`；每条保留配置作者和一个Codex trailer。实现首次暂态离线自动恢复、5/10/15/15秒重试、长调度间隔后的新序号worker探测，以及Extra专用状态stdout和logs命令。状态镜像使用既有三份/每份100MiB轮转，和普通日志隔离。

两种模式以实际Gateway/Kernel/worker和本地加密IM fixture验证离线启动、WS断线、active worker loss后新任务完成，fake Provider实际admission唯一。2026-10-22全量构建测试通过：35项UI和1470项Node通过、32项跳过；lint/names/types/docs/format通过。干净M5代码提交生成的本地0.0.0 tgz在包外离线安装、strict公共类型与工厂/状态sink/恢复探针/CLI验证通过。完整逐项证据和现场入口见[实施记录](../../tasks/93-sleep-wake-recovery/implementation.md)。

用户确认事故npm版本1.1.0、全部Provider范围。原事故Kernel失败层仍未知；本地Bot配置指向生产IM，未进行真实连接或消息试验。reason12保持终态，未核实部署语义前不抢占owner。S01-S14真实合盖/网络/自启与平台矩阵均未执行，P0仍未闭环；95分是计划可执行性自评。

# Kernel复核后补充

用户进一步要求Kernel应像本地常驻服务一样独立于网络。确认监听层不依赖网络，进程暂停模拟后同实例仍可执行；同时定位到快速替换三次耗尽后永久exhausted的策略缺口。M7改为三次快速尝试后串行15秒冷却，普通readiness失败持续低频恢复，连续健康观测60秒才重置策略；清理或所有权失败仍阻断并保留close失败。本地Kernel进程/instance/socket不重建，正常IPC请求没有重启次数限制，旧未知执行不重放。

12项定向测试通过；全量35项UI、1472项Node通过，32项跳过；lint/names/types/docs/format和当前工作树0.0.0包外验证通过。包如实为dirty本地验证构建，没有发布。详细故障注入和SHA检查结果见[实施记录M7](../../tasks/93-sleep-wake-recovery/implementation.md#m7-复核后补充修复)，原事故和真机门槛仍开放。

# 同步最新 main

此处为M8时点；后续授权以文末记录为准。

用户授权推送、英文PR及合并。八个阶段提交无冲突rebase到 `origin/main@d076474`，完整保留 #94 的WebUI Windows会话修复；历史SHA仍表示当时证据。rebase后全量35项UI与1488项Node通过、34项跳过，lint/names/types/docs/format通过。main要求CI Gate和一位审阅者批准，自动合并关闭；按保护完成后续交付，原事故现场门槛和issue #93仍开放，见[实施记录M8](../../tasks/93-sleep-wake-recovery/implementation.md#m8-同步-main-与提交-pr)。

# PR 评审覆盖补充

PR #96原提交已获批准且全部远端门禁通过。用户要求落实P3，在Windows Node 24/26新增五个恢复/状态测试文件的独立步骤；保留原有平台条件跳过，SDK恢复在Windows执行。本机相同命令40项通过、0跳过，远端新提交须重新验CI和批准，见[实施记录M9](../../tasks/93-sleep-wake-recovery/implementation.md#m9-pr-96-windows-测试覆盖补充)。用户最新要求每五分钟跟进到就绪，merge仅由用户手动操作，已更新context授权。
