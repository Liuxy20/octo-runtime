---
type: Plan
title: Issue 69 分阶段实施计划
description: 按公共合同、客户端、owner 管理、消费者、发行和文档分解工作与完成门槛。
tags: [invoke, extra, lifecycle, testing, architecture]
timestamp: 2026-10-20T00:00:00Z
---

# 约束与顺序

用户在审阅规划后要求“开始实施”。实施顺序为 M0 → M1 → M2 → M3 → M4 → M5，不要求为每阶段创建 Git commit。当前用户未授权提交；将来若授权，保留 Git 作者、英文 commit/issue/PR 描述，并按用户要求附一次 Codex trailer。

## M0：合同冻结与最小失败用例

核对远端 main 是否变化及 PR #65 的合并状态。若变更触及 SDK-local、Extra 入口或关闭逻辑，重读相关源码并更新本任务基线；不直接复制 #65 的另一套 invoke。核对设计确认记录。

新增 `test/kernel-invoke.test.js` 的零 Extra 调用、模式重载、未消费 iterator、ACK 丢失及预取消屏障用例。复用 `test/kernel-fixture.js` 和真实本地 IPC relay；不新建模拟协议栈。

完成门槛：A01-A03/A10-A11/A17 的具体断言已可执行，失败原因指向缺失 API；无关键合同待定。

## M1：Kernel 公共 invoke 与原语复用

修改 `packages/octo-runtime-executor-kernel/src/types.ts`、`client.ts`、`index.ts` 和 `public/executor-kernel.ts`。增加 invoke/身份控制/生命周期类型；私有 source 调用既有 admission 与 subscribe，复用原 wire 和修复预算。

针对首次 next、status 返回及发送前补取消检查；修正 submit/invoke 双发自动 cancel 的风险。修改 protocol 的 createInputInvoke 保留 source 的具体错误并区分正常耗尽/主动 return；不改变 Provider 执行、Context 或 native/canonical 输出转换。

完成门槛：A07-A23 定向通过，Core parity 通过。ACK 丢失和断流测试必须计数证明 Provider 未重启；未知不得被 AbortError 覆盖。

## M2：本 client 调用登记与停止

在 executor-kernel 包内新增 `src/invocation-lifecycle.ts`（仅当提取确实减少 client.ts 状态复杂度），按设计实现 128 个元数据登记、在途身份冲突、按 invocationId 控制、deadline 排空及结果摘要。文件不得提供第二个 invoke，也不得依赖 host-sdk/Extra。

扩展 get/subscribe 的已知终态观察，复用原控制方法；增加内部受 deadline 约束的 exchange 能力。排空对未消费的原调用用 get 查询，不为每 Run 增加订阅；新增 IO 并发有界。所有 finally/close 路径去掉 signal listeners 和定时器，未知摘要继续保留。

完成门槛：A12/A18/A20-A29 通过；4 秒 deadline 下接纳 30 秒/恢复 10 秒仍能如实返回 incomplete；无原语重复实现。

## M3：删除 Extra port，同步全部消费者

| 模块 | 修改点 | 必须保留的责任 |
| --- | --- | --- |
| Host SDK `extras.ts` / `extra-entry.ts` | ctx.kernel 注入实际 client，删除 ExtraAdapterHost；runner stopAdmission/drain 后关闭；移除 extra-port.ts | 初始化/停止、插件 dispose、失败租约、4 秒共享预算 |
| `public/extra.ts` 与公开类型 fixture | 删除旧执行类型导出；从 /executor-kernel 使用统一类型 | 两阶段 initializer、config/函数依赖分离 |
| Gateway `extra.ts` / contracts / ports / execution/task / application/im-channel | 直接依赖 KernelClient 方法；删除 ImExecutionPort；取消用 accepted | invoke 结果的 delivery 数据处理及既有业务输入来源 |
| WeCom 对应文件 | 同步直接 client、取消及交互类型 | WeCom 自己的结果 delivery，不复制传输恢复 |
| WebUI `src/index.ts` | list/invoke/取消/交互转为 ctx.kernel 方法 | HTTP/SSE 的业务展示与响应映射 |
| `test/fixtures`、`test-support/public-extra`、测试中的 fake client | 替换旧 port 合同，fixture Extra 调用 ctx.kernel.invoke | 可独立扩展的业务依赖与真实 IPC 验证 |
| `scripts/verify-*-live.mjs` | 逐项核对当前有效脚本，删除旧调用包装和失效私有路径 | 真实验证仍按保护凭据及线上环境合同进行 |

完成门槛：A04-A06/A23-A30 通过；全仓活动代码无 createExtraPort/ExtraAdapterHost/ImExecutionPort/ctx.adapterHost；新 Extra 不需要任何 submit+subscribe 代码。

## M4：仓外发行物与多平台验证

新增 `test-support/public-extra/kernel-invoke.mts`，由 `scripts/verify-release.mjs` 接入已有临时目录/离线安装流程，strict、skipLibCheck=false 编译主包公开入口并运行无 Extra 的真实调用。不能只用 workspace 符号链接证明主包声明闭包完整。

`.github/workflows/ci.yml` 的 Windows 专项命令加入新 invoke/lifecycle/consumer 测试；Linux/macOS 的 `test/*.test.js` 默认包含新增文件。继续使用 Unix socket / Windows Pipe fixture，不创建独立跨平台实现。

完成门槛：A01-A03/A31-A32 有实际构建、包外和平台证据；待运行的平台保持未验，不将本机通过标成三平台通过。

## M5：指南、规则与实际交付记录

更新 Kernel/Core/Host SDK README、三个 Extra README、SDK_NATIVE_INTEGRATION_FULL_GUIDE.md、SDK_CHANNEL_GATEWAY_GUIDE.md、INTEGRATION.md 及 ARCHITECTURE.md 中命中调用合同的部分。

同步 `.octospec/rules/architecture.md`、`local-execution.md`、`invoke-input.md`、`output-protocol.md`、`protocol-design.md`、`extras.md`、`runtime-lifecycle.md` 中将 extra-port 描述为目标层或要求业务手动 submit/subscribe 的段落。更新规则正文时同步 frontmatter/索引；历史 journal 不改写成新实现。

分别给出无 Extra attached、owned.client、Extra ctx.kernel 和 direct Core 示例，说明共同输入/输出及 intentional 进程隔离、环境预算、关闭/清理差异。迁移说明列出删除字段/类型和取消 accepted 语义。

将 A01-A32 的实际结果写入任务 implementation/journal，更新知识目录/log。与 #66/#30 的关系只记录实际完成部分。没有真实 Gateway 联验，不宣称 delivery 故障已恢复。

## 检查命令

以下为实施阶段的命令；实际执行结果见 [实施记录](implementation.md)。按顺序构建一次后复用产物；失败修复后只重跑受影响检查，最终门禁仍按跨包改动执行。

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm format:check
node --test test/kernel-invoke.test.js test/kernel-invoke-lifecycle.test.js test/kernel-invoke-consumers.test.js test/kernel-clients.test.js test/kernel-worker-supervision.test.js test/host-sdk-lifecycle.test.js test/invoke-parity.test.js test/native-host.test.js
pnpm test:suites
node scripts/pack-release.mjs
node scripts/verify-release.mjs dist/release/mininglamp-oss-octo-runtime-0.0.0.tgz
uv run --with pyyaml python .octospec/scripts/lint.py
git diff --check
```

上述新测试文件在 M0-M3 新建。实施环境使用 Node 24、pnpm 11；Windows 包验证继续使用已有 `scripts/verify-windows-release.mjs` 与 CI 的 expected commit 参数。`--require-clean` 仅在真实干净提交产物上使用，不为通过该选项伪造 Git/build metadata。

## 停止条件与恢复

如果出现第二套 Extra invoke、重发原执行、未知结果被当终态、关闭 client 隐式 cancel，必须修复后再进入下一阶段。若 #65 先合并，重读并按本合同迁移，保留其业务存储和 delivery 责任，不合入旧执行端口。未验的平台、线上状态和资源清理失败按原样报告；不能通过降低断言或清空登记取得通过。
