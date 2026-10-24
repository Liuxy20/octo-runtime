---
type: Task
title: DSH 实施准备度评估
description: 在编写产品实现前按现有源码和本机原生探针评估实施准备度。
tags: [dsh, assessment]
timestamp: 2026-10-24T00:00:00Z
---

# 评分口径

用户要求达到 95 分后实施。以下 **95/100 是实施准备度的工程自评**，只回答修改位置、合同和验收步骤是否足以执行；不表示成功概率、完成率或独立评审结论。

| 维度 | 得分/满分 | 证据与剩余项 |
| --- | --- | --- |
| 上游入口与版本 | 20/20 | 已安装 Desktop package 和内嵌 CLI/server 源码，npm 同版 client 类型；真实 initialize/prompt/wait/shutdown 成功 |
| 所有权与失败 | 20/20 | invocation 独占进程、无隐式 resume fallback、关闭后才发终态；资源/容量边界明确 |
| 输入与事件合同 | 19/20 | 已读 Core、SDK、CanonicalEvent；原生 probe 得到事件 keys 和顺序；真实工具样例待实现后采集 |
| 文件与发行路径 | 19/20 | 独立包、两处依赖、CLI manifest、主包公开 adapter 入口；tgz 验证待运行 |
| 可执行验收 | 17/20 | fixture 和本机/IM 步骤明确；IM 凭据与专用群待确认可用；原生 Windows 不在本机 |
| 合计 | **95/100** | 可以实施，交付验收分别报告 |

前置探针：`node /tmp/octo-dsh-probe.mjs`，macOS arm64，Node 24.19.0，2026-10-24。
默认 deepseek-official 无有效 API key，观察到 turn/end error；切换到 Desktop 已登录的 deepseek-account、deepseek-flash 后，观察到 durable assistant/message、turn/end completed、wait 完成、exitCode 0。不修改用户认证。此探针是原生协议可调用证据，不是 Runtime 或 IM 验收。

若新增版本、所有权或终态变化，必须先更新设计和重新评估；不能沿用分数掩盖改变后的缺口。
