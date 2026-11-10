---
type: Plan
title: 四项联合实施顺序与验收矩阵
description: 为协议、Adapter、样例与双包消费安排本地验证，保持既有 CI 范围。
tags: [context, protocol, adapter, testing]
---

# 阶段与实施顺序

- [x] 从最新 main 创建独立 worktree，读取四个 issue 与 #351 评论，建立联合 brief、design 和 context。
- [x] P1：列出删除符号和实际调用点，完成 [各 Adapter 私有 item 的包内合同](adapter-items.md)，核对模式与审批交互；完成 [最新 Gateway 和 evidence 消费审计](consumer-audit.md)。
- [x] P2：联合调整 Schema、生成类型、protocol exports/catalog/helper 及 evidence；不添加兼容别名。
- [x] P3：调整 adapter-sdk、全部内置 Adapter metadata/defaults、模式私有逻辑及 CLI metadata 校验。
- [x] P4：迁移业务内容样例、默认值样例、测试 fixture、当前规则与双语文档；OpenClaw 和 Codex 的专属 README 为权威来源。
- [x] P5：运行本地验证、审查 diff 与实际 CI 范围，记录失败和未验项；更新 journal 和任务状态。

四项共享 Schema 和 adapter-sdk，不采用四份彼此冲突的 schema 变更；在同一 worktree 顺序推进。当前没有提交或远端交付授权。

## 验收矩阵

| 编号 | 可观察条件 | 验证方式 |
| --- | --- | --- |
| A01 / #348 | 公共 source 类型、metadata 要求和来源默认项移除，CLI 能加载无 agentSources 的 Adapter | 全库符号检查、类型检查、Adapter/CLI fixture |
| A02 / #348 | 本地缺 cwd 或坏 cwd 返回既有 WORKDIR 错误；不创建目录；OpenClaw 不要求本地 cwd | 工作目录专项与 fake OpenClaw；记录各平台实际结果 |
| A03 / #349 | item 顶层只含 namespace/name/payload；旧 guidance/data_format 被拒绝 | Schema 与运行时正反样例一致性 |
| A04 / #349 | inline/reference 公共类型/catalog 和 resource 专用 merge 移除；正文、图片和业务历史保持调用方顺序 | 导出/引用审计、输入透传与多模态回归；不得添加渲染或历史拼接 |
| A05 / #350 | model-only、effort-only 和均省略可用；空设置和旧哨兵拒绝 | Adapter SDK 校验与原生请求捕获 |
| A06 / #350 | 最终快照不因执行时补默认而恢复已移除覆盖；显式 defaults/mandatory 组合与调用方清除步骤有准确文档 | 审计配置 helper 调用点、配置组合与恢复会话 fixture |
| A07 / #351 | 公共 actmode/helper/专属 evidence 移除，各模式入口归实际 Adapter 包 | Schema、生成类型、native/canonical 和包外导出检查 |
| A08 / #351 | 私有模式显式配置才触发额外模式操作；Codex/ACP/Grok 省略不触发模式 discovery/set；Claude 省略仍沿审批设置原生 permission mode；原生失败不伪造成功 | Codex 模式不支持不得 fallback；Claude plan 与三档审批组合；ACP 原生 ID；OpenCode full_access 显式 modeId 拒绝；Grok 直接 setter |
| A09 / #351 | Codex/OpenClaw 等包 README 具备字段、缺省、验证和组合示例；公共文档只说明机制并链接 | 双语文档检查、包级合同与代码对照 |
| A10 / 联合 | 私有 JSON items 不被公共层解释或串到 inputs，并发快照相互隔离 | 既有 AgentEnv 直传和输入回归 |
| A11 / 联合 | runtime 与独立 client 的实际发行入口不残留旧类型，包外消费可构建 | 既有双包/包外验证入口，显式本地运行 |
| A12 / 联合 | 既有 CI 范围没有扩张，结果与实际检查列表一致 | 对目标 main 比较 .github/workflows、关联脚本、package scripts、默认开关和 Gate 依赖 |

## 本地检查入口

根据 P1 实际改动选择现有相关测试；新增专项放 `test/manual/` 并显式运行，不加入默认 glob 或 CI。已有测试中受影响的合同断言随实现更新。

```sh
pnpm --filter @mininglamp-oss/octo-runtime-protocol gen
pnpm lint
pnpm lint:names
pnpm typecheck
pnpm test
pnpm docs:check
git diff --check
```

根 `pnpm test` 已覆盖构建和既有测试；不重复执行已通过且输入未变化的检查。全量前先跑相关 protocol/context/configuration/Adapter/actmode 迁移回归以定位失败。双包脚本读取其实际帮助和前置条件后执行，不在规划中伪造通过命令。

原生模式变化须显式运行受影响 Provider 验证，记录源码 SHA/dirty、Provider 版本、实际请求、执行终态与清理事实；不能用 fake 请求捕获冒充真实 Provider 支持。IM 调试按规则连接 im-test，缺环境单独记录。Windows/Electron 与独立 Gateway 未执行时标为 not run，不把外部业务升级当成本仓已完成。

## 规划缺口闭合后的补充断言

- 删除 execution.update/native execution evidence 后，旧帧按不支持的公共事件/控制帧拒绝；session evidence 和 plan.updated 仍通过各自既有校验。
- Codex 请求计划模式但 Provider 不广告时失败，不转换为 default；省略模式时不增加 discovery/set，公开模型和 effort 的省略语义仍成立。
- Claude 私有 permissionMode 仅接受 plan；公共 full_access 与 plan 同时出现时不生成 skip-permissions 参数，缺省时恢复既有审批映射。
- ACP 精确选择广告的原生 ID，不将 default 重写为 build；Grok 的无广告特例只在 Grok 包内；OpenCode 不因 modeId 自动改审批/传输。
- Gateway 的当前生产 model-only/effort-only 构造已符合省略语义。旧 guidance/data_format 的业务配置必须先迁为业务自有类型与校验，再升级 client；Runtime 验收只检查其最终 inputs/agentEnv，不能扩大公共业务合同替下游兼容。

## 交付界限

本地实施与 A01–A12 离线验证已完成，结果见 [validation](validation.md)。真实 Grok 模型执行尚未通过，Windows/Electron 和仓外 Gateway 未验，不能扩大离线通过结论。用户未授权提交、推送、PR、合并或发布；本任务不新增自动化任务或 CI Gate。
