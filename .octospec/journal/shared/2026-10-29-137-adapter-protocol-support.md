# Issue 137：Adapter 协议元数据类型验证

日期：2026-10-29。基线 `origin/main@dcca46fb0eaaa3be675432321f704de92dbdbce0`，分支 `fix/issue-137-adapter-capability`，独立 worktree `octo-runtime-issue-137`。环境：macOS、Node v24.19.0、pnpm 11.19.0、TypeScript 6.0.3。

## 合同与实现

`protocolSupport` 是 Core 注册、模式接纳和流身份所消费的协议描述，与已删除的业务功能标签不同。编写输入允许省略，`defineAdapter()` 按既有约定补 canonical-only 默认值；直接注册的 `HostedAdapter` 必须完整。

- `HostedAdapterMetadata.protocolSupport` 改为必填，运行时校验保持。
- 新增 `DefinedAdapter<TAdapter>` 返回类型，并用于 `defineAdapter()` 与 `createJsonCliAdapter()`。
- 返回类型保留作者自定义字段、方法及元数据，替换可选的协议字段；显式 `undefined` 同样可补默认值，不产生交叉类型为 `never` 的伪保证。
- SDK 双语说明、编写指南和元数据规则同步。工厂仍仅浅冻结，不承诺嵌套元数据不可变。

## 修复前后类型证据

先对基线源码构建，再显式执行：

```sh
pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --module NodeNext --target ES2022 --types node test-support/adapter-protocol-contract.mts
```

修复前退出 2：缺协议元数据、直接 register 和 serveWorker 三处 `@ts-expect-error` 均报告未使用；defineAdapter 与 createJsonCliAdapter 返回的协议字段均仍为 `AdapterProtocolSupport | undefined`，不能赋值给完整协议类型。

修复后相同命令退出 0。fixture 通过根包 `/executor-core` 和 `/executor-kernel` 公开入口检查注册类型，通过 workspace SDK 构建产物检查工厂；未增加发行版 `/adapter` 子路径。正例涵盖省略、显式 undefined、显式 native 声明、自定义字段和 JSON CLI 工厂，反例确认两个注册入口均拒绝可选的编写输入。

该 fixture 只显式本地运行，不加入默认测试脚本或 CI Gate。

## 本地检查

- `pnpm typecheck` 通过；最终返回类型调整后，`pnpm test` 再次完成全仓构建，`pnpm exec tsc -p tsconfig.json --noEmit` 通过。
- `pnpm lint` 通过；最终修改文件单独复查 ESLint。
- 修改的 TypeScript / JavaScript 文件 Prettier 检查通过，`git diff --check` 通过。
- 交付前最终 `pnpm typecheck`、`pnpm format:check` 和 `pnpm lint:names` 均通过；代码审查者在构建完成后独立复跑 strict fixture 和针对性 30 项测试通过。
- `pnpm docs:check` 通过：文档结构检查及 4 项示例执行测试。
- `node --test test/native-host.test.js test/reasoning-levels.test.js test/context-mcp.test.js`：30 项通过。新增场景确认原始缺声明对象仍被运行时拒绝、工厂默认值可注册、native 在 invoke 前拒绝、显式 canonical 执行成功且 shutdown cleanup=complete；现有 Codex / Claude 原生模式回归通过。

## 全量结果与限制

`pnpm test` 退出 1：WebUI 35 项通过；Node 共 2306 项，2213 通过、91 跳过、2 失败。

1. `test/kernel-worker-recovery.test.js` 的 repeated readiness 场景在全量并发时未满足 `failed[4].time - failed[3].time >= 15_000`。单独运行该文件，两项均通过；原 main checkout 单独对照也两项通过。本次未修改恢复代码和该测试，不能将单独通过写成全量已通过。
2. `test/verification-command.test.js` 的 missing installation 场景期望 ENOENT，实际未拒绝。该 fixture 将 Node 所在目录加入 PATH，本机该目录确有已安装的 `octo-cli`。工作分支与原 main checkout 单独执行该用例均以同一断言失败，属于当前环境与既有 fixture 假设冲突。

原始日志保留在本机 `/tmp/octo-runtime-issue-137-test.log`、`/tmp/octo-runtime-issue-137-recovery.log` 与 `/tmp/octo-runtime-issue-137-baseline-recovery.log`。未修改无关测试、重设环境或隐去失败。本次不涉及真实模型与 Provider 运行行为变更，未做真实 Provider / IM / Windows 联调；fixture 证据不代表这些环境已验收。

## CI 与交付范围

相对 `origin/main`，`.github/`、`package.json` 和 `scripts/` diff 为空，未增加 workflow、job、矩阵、触发器、必需检查或 Gate 依赖。既有 native-host 套件内补一个注册合同场景，没有新增专项 CI 入口。

读取基线 SHA 的实际 GitHub checks：CI Gate；Ubuntu 与 macOS 的 Node 24 / 26 Build, test and package；Windows 的 Node 24 / 26 Verify release package；secret-scan / Secret Scan (gitleaks)；draft / Update Release Draft。读取时均 completed/success，这是基线结果，不是本分支的托管检查结果。

初轮验证完成时未提交、推送、创建 PR 或发布。后续用户授权将约束写入评论和 octospec，完成代码审查后提交 PR；两轴均无待修复发现，见[审查记录](../../tasks/137-adapter-protocol-support/review.md)。交付不包含合并或发布，实际 PR 与托管检查状态以 GitHub 为准。
