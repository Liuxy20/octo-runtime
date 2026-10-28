---
type: Journal
title: Issue 222 DSH 最低版本实施
description: DSH 改为最低版本准入并验证真实 rc.4 最终消息转换。
tags: [adapter, testing, installation]
---

# 结果

依用户决定，将外部 DSH Provider 从精确 `0.2.1-rc.3` 改为 SemVer `>=0.2.1-rc.4`、无上限；旧版明确要求升级，probe 返回实际版本。初始化不再锁定 `serverInfo.version=0.0.1`，仍校验服务身份和响应结构。官方 SDK 保持未修改。

116 项针对性离线回归、构建/类型/lint/文档检查和发行包离线安装验证通过。真实 rc.2 被正确拒绝，隔离 rc.4 的发现、握手以及 Kernel 模型请求最终消息均通过，清理 complete。详见[验收与边界](../../tasks/222-dsh-min-version/validation.md)。

可复用合同已写入[Adapter 规则](../../rules/adapter-metadata.md)。GitHub workflow diff 为空；后续双轴审查和 PR 由用户明确授权，状态见任务记录，未发布。
