---
type: Review
title: Issue 335 Gateway 工作目录消费者审计
description: 记录独立 Gateway 的默认目录创建、fixed payload、产物路径消费者及未实施的迁移要求。
tags: [review, workspace, channel, migration]
---

# 范围与限制

只读检查独立 `octo-channel-gateway` main `9ce35ccbc3a8c55abe6890913c295dd622b49170`，审计时工作树干净。Runtime client 依赖为 `^1.1.12`，开发使用同版 Runtime。以下路径相对于 [Gateway 仓库](https://github.com/Mininglamp-OSS/octo-channel-gateway)。本任务不修改 Gateway、不运行其测试，不验证仓外部署或其他消费者；不检查 Work App。用户已取消后续 Gateway #23 实施，本记录不授权恢复该任务，也不声称组合可直接运行。

## 当前配置、目录选择与创建

| 路径 | 当前事实 |
| --- | --- |
| `packages/gateway/src/contracts.ts:31` | agent.workdir 为可选字符串，属于 Gateway 自有业务配置。 |
| `packages/gateway/src/lifecycle/configuration.ts:56-62` | 省略 agent.workdir 时限制 bot_id，避免点路径、分隔符或空字节参与默认目录构造。 |
| `packages/gateway/src/lifecycle/configuration.ts:63-69` | OpenClaw 明确拒绝 agent.workdir，使用自身 Agent 工作区。 |
| `packages/gateway/src/lifecycle/configuration.ts:71-77` | 其他 Adapter 显式 workdir 只检查字符串和绝对路径，没有检查目录存在或可访问。 |
| `packages/gateway/src/execution/dispatcher.ts:71-80` | OpenClaw 选 preset，其余选 provisioned；显式 agent.workdir 优先，否则 provisioned 默认选择 `~/octo-runtime/channels/<bot_id>`。 |
| `packages/gateway/src/execution/dispatcher.ts:82-85` | 提交的 workspace.payload.path 若与该选择不同，拒绝为 IM_AGENT_WORKDIR_FIXED。 |
| `packages/gateway/src/execution/dispatcher.ts:116-121` | 向 Context 输出 `{ mode: "fixed", path: workdir }`，本次 Runtime 会明确拒绝 mode；必须由 Gateway 自己改成 `{ path: workdir }`。 |
| `packages/gateway/src/execution/dispatcher.ts:337-342` | 仅对自己选定的默认目录执行 recursive mkdirSync，mode0700；显式 agent.workdir 不创建。 |

Gateway 在调用前选择和创建自己的默认目录，符合“业务方准备 → Runtime 执行”的归属。保留或调整此默认策略是 Gateway 的产品决定，本次不把它搬入 Runtime。Runtime CLI 与 SDK 的本地执行均要求显式、已存在的绝对路径，没有隐式 cwd 策略；Gateway 如需默认值，应先在自身完成目录准备，再提供具体路径。

## 下游路径与续接

`packages/gateway/src/delivery/artifact-policy.ts:31-36` 仅读 workspace.payload.path，不依赖 mode。`delivery/artifacts.ts:183-213` 将相对产物地址解析到 workspace；缺工作区时报告 workspace-unavailable。迁移 path-only 的字段语义对该消费者不变，但测试和部署仍须验证，不能从只读审计推断已兼容。

执行请求保留在会话调度与冻结重试链中；后续迁移须核对续接和显式恢复仍使用调用方选择的路径。如果目录消失，应处理 Runtime 的 WORKDIR_NOT_FOUND，不重建或另选空目录来继续原执行。调用方临时目录先创建再提交，与普通目录使用同一 Runtime 合同；清理须等使用者和自有资源完成。Gateway 的日志/Home 和 Runtime Home/IPC/Provider 状态均不属于应用工作区分配。

## 独立迁移要求

1. Gateway 若重新获得独立实施授权，更新 dispatcher 的 workspace payload 为 path-only，并核对显式路径在提交时已准备成功。继续由 Gateway 决定默认目录的选择、创建、复用和清理；配置无效不得触发 Runtime 补建。
2. 更新 `test/im-protocol.test.js:825-826`、`test/im-artifact-delivery.test.js:41-47`、`test/run-context.test.js:15-16,44`、`test/runtime-fixture.js:192` 中 fixed/random mode 及计划断言；覆盖明确目录、调用方临时目录、缺失/文件/不可访问路径及续接恢复目录消失。上述是后续测试要求，不是本次通过结果。
3. 更新双语 `reference/configuration.md`、`reference/cli.md`、`getting-started/cli.md`、`guides/contexts-and-credentials.md`、`guides/migration.md`、`guides/sessions.md`，说明 Gateway 自身默认策略和 Runtime 不再提供的模式/分配能力。
4. 与 [Issue 334 提示词消费者迁移](../334-caller-owned-prompts/gateway-audit.md) 一起检查 Gateway 配置与编译入口，使用同版的新 Runtime/client 双包产物验证后再协调发布。旧 Gateway 同时依赖 octo.control/instructions 和 fixed mode，不能直接采用本次删除合同的发行物；不新增兼容层，不凭 `^1.1.12` 宣称未来组合兼容。具体版本由既有发行流程决定，本次不发布 npm。

本仓只完成 Runtime 文档与边界实现；仓外 Gateway 迁移和端到端验收均未完成。
