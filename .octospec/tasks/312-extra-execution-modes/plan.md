---
type: Task
title: Issue 312：实施顺序与交付约束
description: 以可独立验证的步骤完成 Core 清理证据、Extra 双模式、内置迁移及包外验收。
tags: [extra, lifecycle, ipc, invoke, testing, documentation]
---

# 实施计划

本计划已进入实施和验证；M1-M4 已实现，M5 的本机真实 Provider、包外发行和文档验证已执行，结果及未验平台以[验证记录](validation.md)为准。下列步骤保留原计划，不以计划中的测试文件名代替实际命令；专项整合为 test/manual/extra-execution-312.test.mjs 和 extra-execution-builtins-312.test.mjs。

## M1：先证明单次调用可独立收尾

输入：[设计](design.md)、当前 Core owner/cleanup 实现与现有关闭测试。

1. 对照最新 main 重新核对 #296/#309 及本任务基线；若基线变化，更新源码引用和实际差距后继续。
2. 在当前 architecture/extras/local-execution/runtime-lifecycle/engineering/channel 规则中同步 #312 的精确适用范围，标明“目标合同，未完成验收”；不将 #294 KernelService 改成内部 direct 分支。
3. 在 Core 原有 owner 生命周期上新增只读接纳状态与按 receipt 等待清理结果的能力，复用首次 cleanupAttempt。保留现有 invoke/register/shutdown 行为，不另写执行实现。
4. 固定 type 与 public facade 导出。direct 执行器验证使用实际公开类，验收伪对象、跨发行入口的类身份、已关闭对象；若宿主装入两份不兼容 Runtime 构建，应明确拒绝并提示去重，不静默 duck typing。
5. 新增 `test/manual/extra-execution-core-cleanup.test.mjs` 专项，覆盖终态后延迟 finally、失败、未确认、接纳拒绝、错误 receipt 和宿主兄弟调用不受影响。

出口：无需 shutdown 共享 Core，即可分别证明调用 A complete、pending 或 failed；返回终态不能提前获得清理成功。未满足此出口不得进入 direct 产品支持声明。

## M2：建立最小执行接口及 direct scope

主要文件：`packages/octo-runtime-host-sdk/src/execution.ts`、`extra-service.ts`、`extras.ts`、`index.ts`，以及必要的 Kernel 内存窗口复用位置。新文件名是实施建议。

1. 导出 ExtraExecution 与最小 ExtraExecutionContext；保持 InputInvoke 重载，不公开借用 executor/shutdown/全局 drain。
2. 实现配置三分支、字段存在性校验、输入快照与同步错误行为；legacy 规范化为 IPC。只保存 executor 原引用。严格专项启用 exactOptionalPropertyTypes，不修改默认编译开关，并说明消费者关闭该选项的 undefined 边界。
3. 使用对象级协调器、scope 记录和原帧 receipt 保护控制；接纳前的 signal 仅作用于本次准备中的执行。
4. 复用独立 source submit 与中央有界窗口，保障 observer.return 不触发取消。避免误用由消费者驱动的 HostRunService.invokeFrames；不得调用共享 source 的全局 close 来卸载单个 Extra。
5. 将 direct invoke/list、pump、清理凭据和实际 probe 纳入同一停止准入与 drain；保留失败占额及去重阻断。
6. 新增 `test/manual/extra-execution-direct.test.mjs`，覆盖共享/独立 Core、身份冲突、控制隔离、无观察者、慢消费者、窗口缺口及清理超时。

出口：A/B/宿主调用同时运行时，关闭 A 仅影响 A；Core 仍可接纳 B/宿主新调用；scope 内存不会因 observer 脱离无界增长。

## M3：接入 ExtraService 的双模式生命周期

1. IPC 委托已有 attachKernel/client.invocations，保留不可达/恢复与显式取消重试语义。若 #309 先合入，只改共享客户端导入与相应类型，不复制恢复代码。
2. direct 初始化不进入 validateRuntimeHome 的必填分支、不 attach、不派生执行地址；显式 home、controlEndpoint 和 logging 分别按设计校验。
3. 将 stopAdmission/drain/release 接入当前 4 秒共享 deadline；初始化失败与 close 使用同一 drain。保留依赖尾写、迟到 bind 回收、失败租约和重复 close 的原事实。
4. 实现 execution.kind/available 状态和日志。保留 IPC kernel_available；核对 CLI 状态消费者只依赖原 IPC 形状。
5. 保留 ExtraPlugins 现有 IPC 构造用法；为新 execution 注入提供明确类型。测试第三方 Kernel 专属插件继续 IPC，以及 direct 错用后的回滚。
6. 新增 `test/manual/extra-execution-service.test.mjs`，专项覆盖 Home、控制地址、无 Kernel、disabled、初始化/关闭竞态、依赖未结束和失败后替换。

出口：两个精确新配置和旧 endpoint 配置均行为明确；direct 零 Kernel 执行资源；IPC 无服务创建/停止副作用；控制和日志可选失败不掩盖原始错误。

## M4：三个内置 Extra 全部迁移

| 模块 | 改动位置 | 必保留的行为 |
| --- | --- | --- |
| Gateway | extra.ts、ports.ts、execution/task.ts、实际取消/交互调用链 | 固定工作目录、Context/历史、Stop、REST 投递、WS 断线不取消已接纳任务、既有任务过期 |
| WeCom | extra.ts、ports.ts、application/im-channel.ts | 独立传输和业务策略、取消与交互、自己的 disposer，不照搬 Gateway 新策略 |
| WebUI | src/index.ts 的 adapters/invoke/cancel/respond 路径 | Adapter 实际 probe 状态、现有鉴权与交互呈现、原本地调试定位 |

所有内置执行调用改用 context.execution，清除对 Kernel 专属低层 API 的依赖。native 响应保留公开合同，即使当前渠道主要消费 canonical。既有 async question 成对过滤保持，不借迁移增加表单功能。

新增 `test/manual/extra-execution-builtins.test.mjs`：同一真实插件模块分别配 direct 与 IPC，使用可控 Channel/Provider 夹具验证执行、progress、terminal、cancel、interaction；Gateway 另验 WS 断开后同一调用继续执行并走原 REST 收尾。

出口：不能仅自定义 toy Extra 通过就宣布功能完成；三个内置模块均按验收矩阵有证据。

## M5：公开发行、双语文档及独立真实验收

1. 与 #296 核对合并状态，补齐 #312 示例必需的 `/adapters/codex`、createCodexAdapter/codexAdapter 及实际依赖类型；完整其他 Adapter 导出审计仍由 #296 跟踪。
2. 在 public/host.ts、public/extra.ts 和 Core facade 导出实际新类型；root exports、运行 JS、d.ts、打包脚本保持一致。
3. 只安装本次打包 tgz 到仓库外临时工程；用 `skipLibCheck=false` 严格编译，只用主包公共子路径，禁止 workspace/private import、NODE_PATH 或源码软链。
4. 分别运行 direct 宿主与 IPC 的两个独立宿主脚本。IPC 脚本必须传本基线要求的已准备 home；direct 不传 home/endpoint。检查实际 socket/lease/PID 所有权与 complete，而不只检查源码名称。
5. 更新 `docs/{en,zh-CN}/getting-started/sdk.md`、`guides/extras.md`、输出与控制参考、三个 Extra README、`SDK_CHANNEL_GATEWAY_GUIDE.md` 及受影响的架构导航；例子明确所有权和关闭结果。
6. 真实 Codex、测试环境 Channel、Windows/Linux/macOS 与外部 Electron/业务宿主分别记录实现 revision、版本、环境、场景和清理结果。缺失环境写 blocked 或 not run；库内 Node 通过不证明 Electron 打包或真机通过。

出口：包外 fake Provider 证明装配和公共类型；真实 Provider 证明真实 turn/交互；实际发布后的 npm 可用版本另列，tgz 通过不能写成已经发布。

## 预计删除与保留

| 对象 | 处理 |
| --- | --- |
| 内置 Extra 的 ctx.kernel 执行依赖 | 全部迁移到 context.execution |
| direct 中 Kernel 地址/可用性假定 | 删除；不保留伪 client/endpoint |
| legacy 顶层 endpoint、ExtraPlugins IPC 构造及真实 ctx.kernel | 保留有范围兼容，声明类型收窄要求 |
| Kernel endpoint lease、RPC、已有 client 恢复 | 保留，IPC 复用 |
| AgentExecutor 构造/register/原 invoke 和 Provider 准备 | 保留，单次清理与状态只是同实现的附加观测 |
| CLI Home/服务部署与已有用户配置 | 保留，不迁移或重置 |

## 验证命令与 CI

新增专项文件只放 `test/manual/`，下列文件在规划阶段尚不存在。实现后显式运行：

```bash
pnpm build
node --test test/manual/extra-execution-core-cleanup.test.mjs
node --test test/manual/extra-execution-direct.test.mjs
node --test test/manual/extra-execution-service.test.mjs
node --test test/manual/extra-execution-builtins.test.mjs
pnpm typecheck
pnpm lint
pnpm lint:names
pnpm test
pnpm docs:check
uv run --with pyyaml python .octospec/scripts/lint.py
git diff <recorded-target-main-sha> -- .github/workflows package.json scripts
```

先运行风险相关专项，再运行共享合同的原有全量回归。纯规划阶段只执行知识格式、链接、元数据和 diff 检查，不安装 Node 依赖、不调用模型。

已有 release verifier 的默认范围不增加本专项；新增包外双模式验证脚本也保持显式手动调用。打包所必需的公共导出维护可以修改打包实现，但不得让原 CI 打包 gate 自动调用新专项。发布前对比目标分支 workflow/job/matrix/trigger/gate 和实际 check runs；本轮无 PR，PR 检查列表不适用，不能伪造已通过状态。

实现收尾应逐项更新 [A01-A16](acceptance.md)、写 validation/journal，保留 not run/blocked 边界。提交、推送、PR、合并、发布另按当时用户授权处理；Mininglamp-OSS 的 issue/PR/commit 内容使用英文，授权提交时保留配置作者并加一次 Codex trailer。
