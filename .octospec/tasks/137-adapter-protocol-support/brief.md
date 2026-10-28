# Issue 137：Adapter 协议元数据的编写与注册合同

## 目标与归属

自定义 Adapter 缺少 `protocolSupport` 时，当前 `HostedAdapter` 类型允许通过，实际注册却拒绝。目标是让编译期表达现有注册要求，并在 SDK 工厂返回类型中表达已经补齐的协议元数据。

这属于 Runtime 的通用执行合同：Adapter 作者声明实际支持的协议，SDK 工厂按已有约定补 canonical-only 默认值，Core 校验注册和本轮模式，宿主选择 Adapter 及请求模式。`protocolSupport` 是执行路径实际消费的协议描述，不是已经删除的业务功能标签目录。

## 方案与范围

- `Adapter` / `AdapterMetadata` 保留编写输入语义，允许省略 `protocolSupport`。
- `defineAdapter()` 返回 `DefinedAdapter`，明确 `metadata.protocolSupport` 必有，同时保留自定义字段、方法和元数据的类型。
- `createJsonCliAdapter()` 返回同样完整的类型，不能通过宽泛注解重新丢失默认值保证。
- `HostedAdapterMetadata.protocolSupport` 必填，`register()` 和 `serveWorker()` 直接接收完整声明，不隐式补默认值。
- 运行时校验保持；缺省不推断 native 支持，不修改请求默认模式，不改变内置 Provider 的声明和执行。

不新增能力发现、业务准入、协议字段、Provider 调用或装配机制。CLI、SDK、Extra 的调用位置与资源所有权不变；已有手写 HostedAdapter 若缺少字段，需要显式补齐声明。

## 验收

- 显式本地 strict TypeScript fixture 验证：缺字段的 HostedAdapter、register 和 serveWorker 都报错；工厂省略字段后可直接注册，完整元数据和自定义字段可静态访问。
- 既有 native-host 测试覆盖 canonical 默认值、缺声明的运行时拒绝及 native 模式拒绝；内置 Codex / Claude 原有 native 行为回归。
- 按跨包合同执行构建、类型检查、lint 和完整测试；验证结果写入 journal。
- 对照 `origin/main` 检查 workflow 和实际检查列表，不扩大 GitHub CI 范围。专项类型 fixture 只显式本地运行，不加入 CI Gate 或默认测试开关。

## 进度

- [x] 从 `origin/main@dcca46fb0eaaa3be675432321f704de92dbdbce0` 创建独立 worktree。
- [x] 核对根因、架构责任和验收范围。
- [x] 实现类型分层及接入说明。
- [x] 完成本地验证和 diff 复核；全量测试两项失败及对照结果见[验证记录](../../journal/shared/2026-10-29-137-adapter-protocol-support.md)。

## 交付授权与进度

2026-10-29 用户要求将阶段边界写入评论和 octospec 约束，完成实施后 code review，再提交 PR。公开 issue 评论、commit 和 PR 使用英文，保留配置的 Git 作者并添加 Codex trailer。

- [x] 补充字段/工厂就近注释及 octospec 强制约束。
- [x] 在 [issue 评论](https://github.com/Mininglamp-OSS/octo-runtime/issues/137#issuecomment-6475714555)中记录合同。
- [x] 完成 Standards / Spec 双轴代码审查，均无待修复发现，见[审查记录](review.md)。

审查后的交付方式：提交、推送当前分支并向 `main` 创建关联 #137 的英文 PR，不合并或发布；实际交付及托管检查状态以 GitHub PR 为准。不得把本地失败或尚未完成的托管检查写成通过。
