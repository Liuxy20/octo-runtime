---
type: Validation
title: Issue 193 最终验收映射
description: 覆盖 A1–A9、OKF YAML 元数据与公共 list 探测路径的文档验证。
tags: [architecture, documentation, validation]
---

# 验收依据

合同为 [brief.md](brief.md) 与 [spec.yaml](spec.yaml)。本轮从远端审查版本 `1184c04c` 继续并快进至 `82a88313`（已包含最新 main）；仅修改文档及任务记录，对应最终提交版本记录在交付说明中。

| 验收 | 检查与证据 |
| --- | --- |
| A1 | 架构、Adapter 规则及双语架构/IPC 页面明确 Provider 事实、宿主来源展示、Runtime 执行责任 |
| A2 | 架构规则和双语架构页面覆盖官方、代理、自定义 endpoint 与账号差异 |
| A3 | 检查新增正文，无“Codex 永远无查询命令”断言，不据单个 Provider 推导通用发现 |
| A4 | 相对 main 的 diff 仅文档/任务记录，无 API、绑定、目录查询或兜底实现 |
| A5 | 文档明确显式模型、省略默认、原生校验、effort 和生命周期保持既有合同 |
| A6 | triage 开头已撤回旧方案；双语正文人工核对，代码块及 Mermaid 数量、链接与锚点检查 |
| A7 | 完整 OKF lint、变更知识单元 YAML 检查、链接检查与 git diff --check；未运行项单独说明 |
| A8 | Loop 任务附件已保存 brief.md；PR 创建与阶段结果已写回任务，非以本地文件代替上传证据 |
| A9 | 逐份核对架构规则、Extra 规则和三组双语页面：宿主直接查询/传递，或 Extra 消费宿主注入函数，均无 Kernel 业务 RPC；Extra 可选、Provider 无需新增机制，未声称实际查询/发布函数已实现 |

## 公共调用路径

按[审查记录](review.md)追踪公共 `adapter.list` 到 worker RPC 和 `AgentExecutor.describe()`，确认返回 probe 事实；Core `AgentExecutor.list()` 是独立的纯元数据入口。此次添加区别说明，不改返回行为。

## CI 修正与实际验证

失败运行 `41271393276` 的六个平台任务均在既有 `docs:check` 拒绝本次新加的标题锚点，Gate 随之失败。双语架构和 IPC 文档改为整页链接，不修改检查器、workflow 或检查范围。

- `pnpm install --frozen-lockfile --ignore-scripts`：通过，使用已有缓存，manifest/lockfile 无改动。
- `pnpm build`：通过。
- `pnpm docs:check`：通过；18 对双语页面、37 Markdown、22 JSON 示例、16 Mermaid、12 内置 Context 示例，以及 4 个示例测试。
- 完整 OKF lint：通过；586 单元、20 规则；补齐交叉引用后为 3608 本地文件链接。
- 本次 16 份 Markdown 链接检查：820 链接、111 锚点，0 错误；17 个外链未联网验证。
- `git diff --check`：通过；相对 main 无产品代码、schema、绑定或 CI 改动。

此前缺依赖时只运行替代链接检查，未发现默认检查器拒绝锚点；本轮已补齐依赖并运行真实入口。当前不再沿用“默认 docs:check 未执行”的旧结论。

另外，本机临时 Kernel 配合已知 probe 返回值验证：Core `list()` 无探测字段，公共 `KernelClient.list()` 实际返回探测路径与版本，关闭完成。本机已运行的真实 Kernel 通过 `octo-runtime --json adapter list` 返回 14 个 Adapter，其中 13 可用，`qoderclicn` 为 `command_not_found`；脱敏证据已发布到 PR 评论。未运行模型调用、native 跨语言或全量运行时测试；远端各平台结果以新提交的 CI 为准。
