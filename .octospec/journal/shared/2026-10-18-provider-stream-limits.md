---
type: Journal
title: Provider 输出容量修复本地交付记录
description: 记录统一流容量策略、错误分类、Channel 边界判断及本地验证证据。
tags: [p0, adapter, stream, capacity, verification]
timestamp: 2026-10-18T08:30:00Z
---

# Provider 输出容量修复本地交付记录

## 结果

- Provider 原始消息默认 16 MiB，完整 HostFrame 默认 20 MiB。
- Adapter/RPC 队列默认 32 MiB / 4096 项；单 Run 重放默认 32 MiB / 4096 帧，全局重放默认 128 MiB。
- 受信 `adapters.<type>.execution.stream_limits` 可覆盖，单项硬上限为默认值 2 倍；策略按 invocation 冻结。
- 容量失败区分 Provider 消息、HostFrame、队列单项、累计字节和条数，公开分类不可重试，只暴露白名单测量值。
- Channel 256 KiB 仅统计公开消息文本，工具原始输出不进入该预算，本次未改 Channel。
- 错误卡主区域和最终失败文本直接显示公共错误码与诊断编号；HostFrame 超限跨 Host 控制帧保留精确原因。
- 多 Adapter 混合重放配置使用活跃策略中的最高受信全局预算，较低覆盖不会淘汰兄弟 Run。

## 验证

- `pnpm build`：通过。
- 专项 Node 测试：62 项，61 通过、1 条件跳过、0 失败。
- `pnpm test:suites`：WebUI 35/35；Node 1158 项，1149 通过、9 条件跳过、0 失败。
- `pnpm lint`、`pnpm lint:names`、`pnpm format:check`、`git diff --check`：通过。
- Octospec lint 可执行，但被 14 个既有跨仓本地链接阻断；错误未指向本任务文件。
- 合并前双轴审查发现并修复 3 个实现问题及 2 份权威规则旧值；修复后新增专项回归通过。

## 未完成

真实 Codex/Claude/ACP 与 Channel 联调、受控并发内存测量、Windows/macOS/Linux CI 尚未执行，因此 P0 关闭评分为 94/100，不宣称 100 分完成。实现已形成 topic branch 提交；PR/合并状态以 GitHub 为准。
