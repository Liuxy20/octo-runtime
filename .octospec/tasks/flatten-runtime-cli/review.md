---
type: Review
title: CLI 平铺变更自审
description: 核对命令入口、服务 argv、文档与回归的职责及一致性。
tags: [review, runtime, lifecycle]
---

# 自审结果

未发现未处理的 P0/P1。此记录是实现者自审，不替代 GitHub 的非作者审批与受保护合并条件。

- 正确性：生命周期按根命令分派；旧前缀连同 --help 拒绝。专属参数在 Home/服务 IO 前校验，帮助/日志不启动 Adapter。
- 架构：没有命令转换兼容层、额外服务或新 RPC。内部 Kernel 身份及状态键与 CLI 层级分离。
- 安全与生命周期：保留确认恢复、组件锁、启动就绪、有界关闭、配置及数据保存合同；服务 argv 同步更新。
- 依赖影响：所有可执行 CLI 调用方、发行脚本、双语当前文档和诊断建议同步；历史任务事实不重写。Gateway 引导字符串通过独立小改动同步。
- 验证可信度：旧帮助绕过和两个测试迁移假设已修复；全量、发行和突变检查的实际结果见 validation.md，未把跳过的原生平台检查描述为通过。

## COMPREHENSION

1. 原来用户和系统服务都执行 executor-kernel 下的命令；现在直接执行根命令，服务定义中也移除前缀。
2. 旧脚本和旧系统服务 argv 会被拒绝；旧服务需重新 install 更新定义。SDK/IPC、身份与 Home 不受影响。
3. 参数/帮助/拒绝回归、生成 argv 断言和实际离线发行安装后 run/status/list/退出确认验证了关键路径，默认全量测试通过；最终以 PR 外部审批和 CI 门禁合并。

## Standards 独立审查

固定范围 47f0624f…dc473ae6；独立审查者核对仓库标准、命令树、服务参数、身份、文档和调用方，重跑 6 项相关测试全部通过。未发现实现层 P0/P1/P2。

发现公开提交/PR 说明应为英文。PR #331 标题及正文已改为英文，最终使用英文 squash 标题 `refactor(cli): flatten service lifecycle commands`；不重写已推送分支历史。审查者确认该修正解决交付问题，结论更新为 approve。

## Spec 独立审查

固定范围 47f0624f…dc473ae6；结论 approve，无 P0/P1/P2。独立运行 17 项定向回归全部通过，并在临时 Home、空 Adapter 清单下实际运行顶层 run：IPC 就绪、status PID 匹配、adapter list 可用、logs 返回 kernel.ready、SIGTERM 退出码为 0。

两轴审查未替代 GitHub 非作者审批。未声称手工验证 Windows/Linux 原生服务管理器。
