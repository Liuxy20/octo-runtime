---
type: Journal
title: CLI UTC 构建时间实施
description: Issue 31 的构建元数据、只读输出与不可变版本恢复验证。
tags: [cli, build, release, testing]
timestamp: 2026-10-18T00:00:00Z
---

# 实施范围

从最新 main `f6de54f` 建立独立 worktree，实现 [任务合同](../../tasks/cli-build-timestamp/brief.md)。`buildTime` 写入 CLI 产物，版本及根帮助展示 `build:`；无效或缺失时间显示 unknown，不依赖运行时的时区、cwd 或时钟。commit、dirty 与源码占位版本不变。

发行构建复用一次 UTC 构建会话时间。恢复已发布版本时，从经过 SHA512 与源码身份验证的 registry archive 读取原时间；完整 tgz integrity 门禁保持不变。打包不重新生成 metadata，Linux/macOS 与 Windows 安装验证比较 archive 和安装后的 metadata，并检查全部版本及根帮助别名。

# 本地证据

- 构建通过；22 项定向测试通过，覆盖无 Git、clean/dirty、时间覆盖校验、旧/损坏 metadata、时区稳定、只读 CLI、发行及 Windows verifier。
- lint、命名检查、全仓格式检查及根 TypeScript noEmit 检查通过。
- 全量 Node 测试 1173 通过、9 条件跳过、0 失败；WebUI 35 项通过。
- 独立发行包（本地验证版本 1.0.2，未发布）离线安装、全局 CLI、daemon、内置 Extra、公开类型及卸载验证通过；同一构建连续打包 tgz 字节一致。
- 双轴评审及三平台 PR CI 在交付阶段追加结果；本记录不把待执行项写成通过。
- 本需求不更改 Provider、Channel、协议或执行默认行为，不调用真实模型，也不创建或移动 tag。
