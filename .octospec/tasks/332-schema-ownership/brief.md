---
type: Task
title: Issue 332 协议 Schema 职责清理
description: 分离协议定义、客户端默认配置与测试资产，清理失效合同并验证双包发行。
tags: [protocol, schema, client, packaging]
---

# 目标与授权

Issue：https://github.com/Mininglamp-OSS/octo-runtime/issues/332。
用户授权最新 main → 独立 worktree → octospec 方案与至少 95 分可执行性 → 实施 → 正式英文 PR → 合并 main；不发布 npm/tag，不扩大 CI。
基线为 origin/main `86b3379cc9b426255dabc85c1450dfd530ac1c94`；worktree 为 `/Users/lvsijia/.codex/worktrees/issue-332-schema-cleanup/octo-runtime`，分支 `refactor/332-schema-ownership`。

业务目标是接入者能明确区分协议、客户端默认值和测试数据。决定权归协议维护者；客户端预算和重试仍由现有客户端实现拥有，不把默认值升级为所有客户端必须遵循的 wire 要求。输入、权限、接纳、取消、恢复及 Provider 行为不变；不替 Gateway/宿主决定产品行为。

## 关键合同与设计

1. `schema/` 仅保留公共数据与 IPC 两个 Draft-07 Schema。七份样本原样迁入协议包 `test/fixtures/`，更新当前消费者。已有公开 IPC conformance fixture 入口保持原导入路径，发行时仅复制这一份到专用 fixtures 路径；其他测试样本不发布。
2. 删除 `kernel-client.behavior.json` 和 client `/protocol/behavior.json` 导出。它没有生产 TS 配置消费者，不新造 config 文件：connections/invocations/control/lookup、timeouts、repair delays 继续由 client 现有实现维护；request/line byte 上限继续使用实际共享协议常量；field maps/defaults/lifecycle/ownership 不建立第二份元数据。
3. IPC Schema 的 title/$id 更新到当前 v2，所有本仓引用同步；Run 7、Context v3 和 IPC v2 的实际 wire 值不改变。不提供旧 behavior 导出的兼容副本。
4. 删除无当前 Runtime 生产调用的 10 个渠道/历史同步定义及 ContextContinuityPayload、ContextSelectionEntry、ContextResourceEntry，共 13 个定义，并清理其导出/校验器/专属测试。用户追加“不用管 workapp”，以 Runtime 当前职责和引用图为准，不为 Work App 保留闲置类型，不修改或验证 Work App。
5. 删除失去 native 生成器消费者的 `x-octo-methods` 方法映射，保留实际 RPC 请求/结果定义及方法。生成器在现有生成文件输出 Schema 派生的 IPC 版本和 Run 错误码列表，替代生产代码中的重复声明，不增加运行依赖或另建协议框架。
6. 保留有实际语义的 `x-octo-*` 扩展并明确其非标准校验边界：普通 Draft-07 校验器只能检查标准关键字；字节、深度、Unicode、唯一性和跨字段约束由现有运行时/测试语义校验承担。明确手写校验仍存在，不宣称已完全自动生成。
7. 双语 README/SDK/IPC 文档、protocol-schema 规则与打包白名单同步。删除公开类型/behavior 导出及变更 Schema ID 属于显式接口清理，记录调用方升级要求；IPC 样本入口保持。

## 实施里程碑

- M1：方案、消费者证据、验收和可执行性评估，提交可审阅的规划。
- M2：目录/发行资产、Schema/生成/校验清理和双语合同同步；整体构建及针对性回归通过后提交。
- M3：本地手动专项、既有全量检查和双包包外验证；独立审查与问题修复、验证记录/journal 提交，正式 PR 等待既有 Gate 和审批后合并。

Schema/生成/核心清理、资产/打包和文档按不重叠文件边界协作，根负责人统一集成。审查代理不自行提交。PR 不使用 draft；合并不绕过保护、审批或失败检查，保留 Codex trailer。

## 范围外

不重写所有校验器、不引入 Ajv 运行依赖、不改变 Provider 执行/会话/审批/恢复；不修改或验证 Work App，不修改其他仓外项目或生成其 vendored SDK。破坏性导出变更须公开说明。不改 workflow、job、矩阵、触发器、必需状态、Gate 依赖或默认测试选择；新增专项仅在 `test/manual/` 显式运行。

## 验收

| 编号 | 可观察条件与证据 |
| --- | --- |
| A1 | schema 目录恰有两个 *.schema.json；七份样本迁移字节一致，既有样本测试仍执行 |
| A2 | behavior 文件/导出/当前文档指引退出，默认值无行为变化；默认配置归属逐字段记录 |
| A3 | IPC schema ID/title、status/客户端检查使用 v2；版本/Run 错误码由 Schema 生成，既有合同回归通过 |
| A4 | 13 个删除定义无剩余 Runtime 活动引用；记录公开删除清单；不以 Work App 兼容为验收条件 |
| A5 | 标准 Draft-07 可编译，扩展语义边界与手写校验职责有双语说明；生成产物无漂移 |
| A6 | runtime/client 实际 tgz 仅含两个 Schema 与刻意保留的 IPC 样本，无 behavior/其他 fixtures；旧公开 IPC 样本可导入 |
| A7 | pnpm lint、lint:names、format:check、typecheck、docs:check、test:suites 与 octospec lint 的实际结果；失败需修复或有同基线证据 |
| A8 | 手动清理专项及既有 client 包外安装/API验证通过；不把 fake Provider 结果称为真实模型/IM 验收 |
| A9 | 相对目标 main 的 workflow diff 为空；默认测试选择不增加专项；PR 实际检查列表保持既有范围 |
| A10 | 正式英文 PR 关联 Closes #332；通过原 Gate/审批后合并，远端 main 包含结果；保留配置作者和 Codex trailer |

执行记录写入 validation.md；规划评分不代替实际验收。纯资产/合同整理没有新增真实 Provider 行为，真实模型、IM、Windows/Linux 原生服务本轮不作本地通过承诺。
