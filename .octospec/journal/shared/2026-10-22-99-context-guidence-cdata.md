---
type: Journal
title: Issue 99 模型 Context 指引与数据边界验证
description: 共享 renderer、数据保真、双语格式说明及本地回归结果。
tags: [context, model-input, testing]
timestamp: 2026-10-22T00:00:00Z
---

# Issue 99 模型 Context 指引与数据边界验证

需求与归属见[任务简报](../../tasks/99-context-guidence-cdata/brief.md)。基线为 `origin/main@20c3771`，分支为 `fix/99-context-guidence-cdata`。

## 实施与合同核对

- Core 共享 `renderModelContexts` 将首尾固定边界改为标准 XML 注释。
- API 仍接收 `guidance`；模型可见 `<guidence>` 保留原始 Markdown 的真实换行、空行、缩进、特殊字符和字面量反斜杠，不包 CDATA，缺省或空字符串省略。
- 既有排序后的 payload JSON 以 `<data><![CDATA[...]]></data>` 包裹，全部终止符拆成相邻 CDATA 区段，不解析内层材料或改变数据合同。
- 未修改过滤、顺序、输入快照、可信控制指令、执行配置或协议版本。既有 Host 测试验证 canonical/native 模式及主输入、multipart 和 fresh fallback 共用结果且仅注入一次。
- 已更新双语 Context 参考、协议 README 和唯一 Context 输入规则；双语代码示例保持一致。
- 本地自查未发现未处理的需求项：全部包装行为位于共享 renderer，没有新增 Provider 分支、数据解析或业务决策。

## 本地验证

- `pnpm install --frozen-lockfile --ignore-scripts`：通过；后续显式构建。
- `pnpm typecheck`：通过，包含 workspace 和公共入口构建。
- `pnpm lint`：构建后通过。首次与首次构建并行运行时，尚未生成的 workspace 类型导致类型解析报错；构建完成后原命令通过，无需源码修正。
- `pnpm lint:names`、`pnpm format:check`、`git diff --check`：通过。
- `pnpm docs:check`：通过，17 对双语页面、35 个 Markdown 文件、18 个 JSON 示例、16 个 Mermaid 块、12 类内置 Context 示例，另有 4 项文档行为测试通过。
- `node --test test/model-context.test.js test/run-context.test.js test/context-extension.test.js`：17 项全部通过。
- `pnpm test:suites`：UI 35 项通过；Node 1526 项中 1491 项通过、35 项跳过、0 项失败。
- `git diff --exit-code -- pnpm-lock.yaml packages/octo-runtime-protocol/src/generated/protocol-types.ts`：通过，无生成或锁文件漂移。

自动化使用 fixture Provider，未调用真实模型或线上 IM；本次只改变共享模型文本格式，不宣称已验证模型理解质量。远端门禁、PR 和合并状态以 GitHub 实际结果为准。
