---
type: Task
title: Issue 99 模型 Context 指引与数据边界
description: 标准注释、原始 Markdown 指引与 CDATA 数据包装。
tags: [context, model-input, testing]
timestamp: 2026-10-22T00:00:00Z
---

# Issue 99 模型 Context 指引与数据边界

需求：[GitHub #99](https://github.com/Mininglamp-OSS/octo-runtime/issues/99)。基线为最新 `origin/main@20c3771`，独立 worktree 分支 `fix/99-context-guidence-cdata`。

## 目标与归属

- 业务目标：让模型明确区分如何使用材料的 Markdown 指引和原始材料，保留实际换行及格式。
- 决定权与显式输入：业务方继续提供有序 Context v3 items、可选 guidance 和对象 payload；不增加业务决策或字段。
- 合同内动作：Core 共享 renderer 输出标准 XML 注释、原始 `<guidence>` 和 `<data>` 内的 CDATA；按现有顺序和过滤规则注入各输入路径。
- 越界动作：不解析内层材料格式，不改 payload schema/序列化，不读取引用，不改变可信控制通道、会话或业务指引内容。
- 影响：SDK、CLI、Extra 经共享 Core 进入模型的边界文本改变；匹配旧格式的提示词、快照和解析器需同步更新，不影响执行配置与协议版本。

## 范围与验收

1. 首尾 `<--- ... --->` 改为 `<!-- ... -->`，固定描述继续为英文。
2. 模型标签使用既定拼写 `<guidence>`，输入字段继续为 `guidance`；Markdown 不转义、不包 CDATA，保留真实换行、空行和缩进，空值省略。
3. 现有排序后的 payload JSON 只增加 `<data><![CDATA[...]]></data>` 外层；全部 `]]>` 拆成相邻 CDATA，区段正文连接后与原序列化文本相同。
4. 保序、无修改输入、过滤和空 Context 行为保持；正常文本、multipart 和显式 fresh fallback 输入使用同一共享结果。
5. 更新相关测试、双语参考文档和 Context 规则；运行 lint、类型构建、文档检查、完整回归及 PR 门禁。

用户已授权提交、推送、创建 PR 并合并 main。按用户 OSS 约定，远端 issue/PR 和 commit message 使用英文，保留配置的 Git 作者并添加 Codex trailer。
