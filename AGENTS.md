# Octo Runtime 开发指引

本项目是内部 TypeScript monorepo。沟通和文档直接使用中文。

先读 [OKF 知识目录](.octospec/index.md) 与 [基础架构](.octospec/rules/architecture.md)。Runtime 是本地运行时设备，AgentExecutor 是唯一执行实现；服务装配与调用遵守 [SDK 原生装配与统一 RPC](.octospec/rules/architecture.md#sdk-原生装配与统一-rpc)，宿主独立管理 Extra。#294 原生对象装配已在工作树实现，验证状态见对应任务。本地存在和执行不以登录、云端登记或 IM 建联为前提。

## 目录与命令

- `apps/`：CLI 宿主入口；不再包含旧架构的独立应用。
- `packages/`：协议、Executor Core/Kernel、Host SDK、Provider Adapter 和 Extra。
- `test/`：跨包测试；包内测试按各包目录维护。
- `.octospec/rules/`、`.octospec/guides/`：当前合同与操作指南；历史结论放 journal。
- `docs/{en,zh-CN}/getting-started/cli.md`：设备部署与运维（Home、生命周期、Gateway 配置、诊断）。
- `docs/{en,zh-CN}/getting-started/sdk.md`：SDK 原生启动、事件消费与 Extra 装配；`docs/{en,zh-CN}/guides/extras.md` 是 Extra 细节。
- `SDK_CHANNEL_GATEWAY_GUIDE.md`：仅接入 Octo IM，OctoBuddy 推荐入口。
- `INTEGRATION.md`、`DEPLOYMENTS.md`：选型导航及发行部署入口。
- `pnpm build`：构建 workspace。
- `pnpm typecheck`：构建并检查类型。
- `pnpm lint`、`pnpm lint:names`：代码和命名检查。
- `pnpm test`：构建并运行 Node 测试。

规则正文只维护在 `.octospec/rules/`。本文件和 `CLAUDE.md` 提供入口，不另存一套架构约束。

## 核心代码与接入注释

核心实现及接入使用代码必须遵守[核心代码注释要求](.octospec/rules/engineering.md#核心代码注释要求)，尤其是 Executor Core、Executor Kernel、Host SDK 及其调用示例。新增或修改核心逻辑时，必须同步维护就近的中文注释：公开入口说明输入、输出、所有权和调用顺序；复杂分支说明设计原因、状态转换、取消/超时竞态与失败边界。评审须检查注释与当前实现一致，禁止只改代码而保留过时合同，或将请求受理、终态、资源回收混为成功。避免逐行复述代码。

<!-- octospec:begin -->

## octo-spec 工程规范

本仓库将工程知识保存为 `.octospec/` 下的 OKF Markdown，供各编码 Agent 共用。

1. 修改前读取 `.octospec/rules/_index.yaml`，按路径或任务标签读取命中的规则全文，优先处理 `load_bearing: true`。架构正文在 `.octospec/rules/architecture.md`。
2. 全局规则位于 `.octospec/_global/`，由固定版本同步。同 `id` 的仓库规则覆盖全局规则；中文协作约定见 `rules/collaboration.md`。
3. 非简单代码改动在 `.octospec/tasks/<slug>/brief.md` 记录目标、关键合同、范围和验收依据，在 `context.yaml` 记录实际读取的规则。已有明确需求按用户授权执行；仅在缺少关键决策时询问。
4. 实现后对照规则与验收项检查 diff，按改动范围运行检查。真实接口调试必须连接线上测试环境，验证记录不得包含凭据。
5. 收尾时将可复用结论回写规则，将验证结果写入 journal；`learnings/pending/` 只放待决问题。提交、推送、创建 MR 按用户授权执行。
6. YAML 元数据为强制要求：新建或修改 `.octospec/{rules,guides,tasks,journal,learnings}/` 中的知识 Markdown，必须在文件开头写完整 `---` YAML frontmatter，包含非空字符串 `type`、`title`、`description` 及列表 `tags`。`brief.md`、`review.md`、`validation.md`、journal 分别声明 `Task`、`Review`、`Validation`、`Journal`；规则与指南使用 `Rule`、`Guide`。已有文件缺失时必须随本次编辑补齐。`index.md`、`log.md`、`*.template.md` 沿用检查器豁免，`context.yaml` 不加 Markdown frontmatter。交付前必须检查本次涉及文件的元数据，并运行 `.octospec/scripts/lint.py`；本次错误修复重验，未修改的历史错误独立报告。

说明、任务、评审和提交描述直接使用中文；字段、命令及专有名称保留原文。Claude Code 可使用 `/octospec-plan`、`/octospec-go`、`/octospec-check`、`/octospec-finish`，其他 Agent 执行同一流程。

此区块由 `.octospec/scripts/sync.sh` 从本仓库的 `AGENT-BLOCK.md` 同步；修改源文件后重新同步。
<!-- octospec:end -->
