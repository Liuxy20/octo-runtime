---
type: Task
title: Issue 69：Kernel client 统一 invoke 合同
description: 为直接宿主和全部 Extra 提供同一个完整异步调用入口，移除 Extra 执行端口。
tags: [architecture, invoke, ipc, stream, extra, lifecycle, testing]
timestamp: 2026-10-20T00:00:00Z
---

# 目标与状态

需求来源：[Issue #69](https://github.com/Mininglamp-OSS/octo-runtime/issues/69)。用户在规划评审后明确要求“开始实施”。产品代码和本地验收已进入实施，结果见 [实施记录](implementation.md)；未提交、推送或创建 PR。

基线为 fetch 后的 `origin/main@fae6333632010602506774b0648b639b70d25e22`；分支为 `feat/69-kernel-client-invoke`，worktree 为 `/Users/lvsijia/github.com/Mininglamp-OSS/octo-runtime-kernel-client-invoke`。

宿主业务模块无需创建或加载 Extra，即可调用 `client.invoke(input, environment?)` 并消费输出。Gateway、WeCom、WebUI 和第三方 Extra 使用同一个 Kernel client。Kernel client 内部负责提交执行、取得原 Run 身份、订阅输出、断流续接以及真实终态的传递；消费者无需依次调用 submit/subscribe。

## 用户确认与设计状态

- 用户要求新 feat worktree、OctoSpec 规划、需求/方案/验收确认，以及可执行性超过 95 分。
- 2026-10-20 用户明确：当前未 stable，支持破坏性更新；不兼容旧接口，按最清晰的使用方式重构接口合同。
- 用户进一步明确：Channel Gateway Extra 仅拿 invoke 的结果做 delivery 数据处理。因此 Gateway 不承担上述提交、订阅、恢复、执行身份关联或传输终态判断，也不为 Kernel 编写调用包装器。已有业务请求构造不因此迁入 Kernel；本任务只迁移执行调用和结果接线。
- 本任务已确认上述需求及破坏性迁移边界。[详细设计](design.md)中的新增类型、方法名和取消错误优先级是本轮工程建议，不能记录成用户逐项批准。用户随后发出“开始实施”，据此授权按本设计执行；不将该授权扩展为提交、推送或发布许可。

## 责任与范围检查

| 检查 | 结论 |
| --- | --- |
| 真实需求 | 内部 App 和各种业务接入都需要一次完整执行，不应自行提交后再订阅 |
| 决定权 | 公共执行合同归 Kernel；实际执行归唯一 Core；delivery、展示和业务存储归消费者 |
| 显式输入 | InvokeInput 中的 inputs/contexts、模式及既有可选字段；signal/执行环境在第二参数 |
| 首个合同缺口 | KernelClient 缺少 invoke；不是 Gateway delivery 的问题 |
| 其他产品影响 | 所有消费者共享入口；不替调用方决定模型、会话、Context、存储或 delivery 策略 |
| 自动动作依据 | ACK 查询和原游标续接复用现有有界机制；取消只来自 caller 显式信号/控制请求或 owner 明确停止 |

## 关键合同

1. `KernelClient.invoke` 是直接宿主和全部 Extra 的共同入口，返回异步输出流；attached 与 owned.client 类型相同。
2. 保持 InvokeInput 对象形态。省略模式返回 native HostFrame；canonical 返回 CanonicalEvent。不改成 `invoke(inputs, contexts)` 两个位置参数。
3. 一次调用只提交一次。ACK 丢失查询原身份；断流从原 ref 和最后连续 seq 恢复。不得重新执行。
4. accepted、取消请求被接纳、输出观察结束、Provider 终态和资源清理完成分别表达。未知结果与重放缺口必须可见。
5. caller signal 明确请求取消；owner 停止显式取消本 owner 的 Runs 并有界排空。iterator/client/subscription 关闭本身不取消已接纳 Run。
6. 删除 `createExtraPort`、`ExtraAdapterHost` 和 `ctx.adapterHost`。Extra 接收 `ctx.kernel: KernelClient`，直接调用它；内部窄类型可以引用 KernelClient 的方法类型，不得再定义另一套执行合同。
7. Kernel 内维护通用的本 client 调用登记与控制；Host SDK 只决定停止顺序、期限及所属 client，不再实现 submit/subscribe 组合。
8. Channel Gateway 消费 invoke 输出并做 delivery 数据处理。Kernel/Core 不出现 Gateway、Bot、卡片、消息投递或业务存储分支。

## 范围外

不实现 Loop、Go client、持久 Run 恢复、Gateway 存储工厂、最终卡片/文本保证投递、Context 重设计或 Provider 新能力。不将 #65 未合并代码当成本基线。不删除或重建 Home、身份、profile、凭据及用户数据。

## 规划产物与通过条件

- [接口与生命周期设计](design.md)：确切类型、取消和关闭行为、资源限额与替代方案。
- [验收矩阵](acceptance.md)：A01-A32，逐项触发、可观察结果和验证位置，实际结果另列实施记录。
- [实施计划](plan.md)：M0-M5 的文件、依赖、完成门槛和检查命令。
- [可执行性评估](assessment.md)：按有依据的工程准备度评为 96/100，独立标注方案确认状态和未执行测试。
- [实际读取与决策](context.yaml)：基线、来源、命中规则、授权和规划验证证据。

实现完成必须通过 A01-A32 的适用检查。方案分数不代表代码完成率、测试覆盖率或成功概率；当前实际证据及未验平台见实施记录。
