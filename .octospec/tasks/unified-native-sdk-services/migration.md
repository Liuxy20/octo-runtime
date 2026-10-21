---
type: Plan
title: 统一原生服务删除清单与实施顺序
description: 依据 main 源码枚举 launcher 消费方及 runner 装配，并规定架构先于迁移的检查点。
tags: [architecture, extra, lifecycle, testing]
status: implemented
---

# 迁移原则

当前基线为 `main@70f0247`。旧分支清单按最新 main 重新核对：共享 invoke、调用登记、ExtraContext.kernel 和 extra-port 删除已由 #73 完成；#72 的 Gateway 排空、失败确认及 Node-only 约束同样作为基准保留。新增 Gateway 关闭测试和真实验证脚本改用原生工厂，不恢复旧 launcher。新 API 先具备最小原生服务实现和外部类型 fixture，再迁移消费者；不得先将旧 launcher 换名而继续交付相同拓扑。旧 tasks/journal 是历史证据，不批量改写；现行规则、指南和运行示例必须一致。

## 删除与替换映射

| 基线位置 | 计划处理 |
| --- | --- |
| `packages/octo-runtime-host-sdk/src/kernel.ts` | 删除 startOwnedKernel、OwnedKernel、OwnedKernelOptions、专用 stop/restart 与 launchNode 调用；不留 alias |
| `packages/octo-runtime-host-sdk/src/extra.ts` | 删除 startExtra、OwnedExtra、ExtraLaunchOptions 及顶层进程 launch；建立普通可导入 Extra 服务模块，或按职责重写此模块 |
| `packages/octo-runtime-host-sdk/src/index.ts`、`public/host.ts` | 删除旧导出，导出共同服务生命周期与 Extra 服务；Kernel 公共出口归 Kernel 包 |
| `packages/octo-runtime-executor-kernel/src/server.ts`、`index.ts`、`public/executor-kernel.ts` | 将现有 socket/Run/worker 实现组织为 createKernelService；取消另一个公开 startKernelServer 构造合同 |
| `packages/octo-runtime-executor-kernel/src/entry.ts` | 删除 SDK 再启动顶层 Kernel 所需的专用 entry；CLI run 已是部署入口，不需要 SDK entry 替身 |
| `packages/octo-runtime-executor-kernel/src/process.ts`、`supervisor.ts`、`serve.ts`、`rpc.ts` | 复用既有内部执行隔离，仅按库内实际改动修正调用；不额外启动外部宿主适配项目，禁止引入外部 Node 代启服务 |
| `packages/octo-runtime-executor-kernel/src/client.ts`、`types.ts`、`invocation-lifecycle.ts` | 原样保留最新 main 实现；服务关闭内部使用已有 invocations，业务不手动接线 |
| `packages/octo-runtime-host-sdk/src/extra-port.ts` | main 已删除，本次无新增修改 |
| `packages/octo-runtime-host-sdk/src/launch.ts` | 从 Kernel/Extra 原生服务路径删除 launchNode；共同清理类型与 deadline 移到普通生命周期模块；外部原生组件仍有真实使用的部署辅助不得伪装成 Kernel 启动路径 |
| `packages/octo-runtime-host-sdk/src/dependencies.ts`、`process-channel.ts` | 审计剩余使用方；删除仅为原生 Extra 另起进程而存在的依赖代理，不删除真实在途占额、迟到结果保护或其他有效使用方 |
| `packages/octo-runtime-host-sdk/src/native.ts` | 保留真正外部原生组件用途；不得成为 Runtime Kernel/Gateway 的替代 launcher，不借本任务实现 Loop |

## extra-entry.ts 装配迁移

| runner 现有责任 | 目标责任模块 |
| --- | --- |
| 读 argv/config、process message、SIGINT/SIGTERM、process.exit/进程组退出 | CLI/deployment 入口；不得进入普通 SDK 服务 |
| descriptor/module 解析、模块 name 校验 | CLI 将声明解析为模块对象；SDK 工厂检查公开模块和 JSON 合同，两者复用通用校验 |
| RuntimeLogging、ExtraPlugins 实例、两阶段插件初始化 | createExtraService 的普通可导入实现 |
| attachKernel、执行登记/取消/排空、业务状态与 Kernel 可用性组合 | 同一 Extra 服务实现，invoke 委托 KernelClient |
| controlEndpoint、连接跟踪、endpoint 租约与释放 | 同一 Extra 服务，作为可选控制监听能力；socket 在调用进程内创建 |
| 宿主函数代理或 dependencyModule 动态 import | 原生服务直接注入 D；CLI 在自身 composition root 构造依赖，不要求 App 走代理 |
| 等待初始化结束、失败回滚、dispose、日志及端点清理 | 同一服务生命周期，返回 ServiceCleanupResult；不得 process.exit |

`extra-entry.ts` 最终删除；若独立发布的部署工具仍有明确使用方而保留 entry，则只能是读取部署参数后调用同一工厂/initialize/close 的薄入口，不能留任何独有服务装配，也不能由原生 SDK 隐式启动它。当前主 CLI 直接运行服务，不依赖该入口。

## 全部现有消费者

| 位置 | 迁移及需保留的证据 |
| --- | --- |
| `apps/cli/src/main.ts` | 两个 run 分支各自在本进程构造服务；start 等部署命令仍分别交给原生 manager；去掉 child.exited 假设，观察 service.closed/状态 |
| `apps/cli/src/playboard.ts` | 本进程构造临时 Kernel 服务，调用 client.invoke；删除手写 submit/subscribe 组合；关闭只影响临时实例 |
| `test-support/public-extra/host.mts` | 主包外普通 SDK 消费新 API、完整终态和 scoped close，保留 skipLibCheck=false；与 CLI 使用相同公共构造合同 |
| `test/host-sdk-lifecycle.test.js` | 从 owned 进程测试改为服务对象生命周期、共享 Kernel 与 scoped Runs；拓扑进程由测试部署入口启动 |
| `test/component-startup.test.js` | 保留启动中取消、迟到资源、清理不全、阻止替换的回归意图；不机械删除失败测试 |
| `test/cli-channel.test.js` | 删除匹配旧函数名的断言，增加真实进程 PID/socket 及 Gateway 不启动 Kernel 的断言 |
| `test/fixtures/startup-owner.mjs`、`extra-owner.mjs` | 测试入口本进程调用同一服务 API；进程退出属于 fixture 部署责任 |
| `test/kernel-fixture.js`、`test/fixtures/kernel-cleanup-failure.mjs` | 从 startKernelServer 迁到新统一生命周期，保留 endpoint/manifest 释放失败证据 |
| `scripts/verify-channel-features-live.mjs` | 用新 Kernel 服务与同一 client.invoke，不再导入内部 extra-port |
| `scripts/verify-channel-group-entrypoints-live.mjs`、`verify-runtime-hourly-logs-live.mjs` | 原生服务工厂直接初始化；保留真实业务行为与日志验证，凭据不入仓 |
| `scripts/verify-release.mjs`、`scripts/pack-release.mjs` | 严格类型/包外运行检查改为统一服务；检查发行物含新公开入口与内部 worker，删除旧 entry 依赖和 ownedKernel 成功标签 |
| `public/extra.ts`、插件 ExtraContext 使用方 | 保留 main 的实际 KernelClient；仅将业务依赖类型聚合到业务出口，插件执行代码不变 |

## 现行文档同步

实施阶段一起更新 `README.md`、`ARCHITECTURE.md`、`SDK_NATIVE_INTEGRATION_FULL_GUIDE.md`、`SDK_CHANNEL_GATEWAY_GUIDE.md`、`release/README.md`、Host SDK 与三个 Extra 的 README，以及 `.octospec/guides/extra-configuration.md`、`channel-dynamic-contexts.md`、`operations.md`。检查 `CLI_USAGE_GUIDE.md`、`INTEGRATION.md`、`DEPLOYMENTS.md`、AGENTS/CLAUDE 入口不再误述服务拓扑。

本规划先修正架构规范与相邻规则中的冲突，并给尚未迁移的实现说明加状态限定。不能提前将旧指南示例换成尚不存在的新 API，再声称其可运行。最终允许在迁移说明中提及被删除的符号，但必须消除运行路径、公开声明及主要用法中的旧合同。

## 实施顺序与完成条件

1. **M0：库内接口与边界核对。** 对照 issue、源码和相同 SDK 调用示例审查服务签名，确定共同 invoke 与清理接口。复用现有 Kernel server、ExtraPlugins 与内部 worker，不将外部 Electron 工程验证作为开发前置条件。
2. **M1：Kernel 原生服务。** 收敛一个工厂与生命周期，实现 status/失败回滚/close，移除 SDK 顶层 Kernel launcher；与 #69 共用 invoke 和 Run 机制。用 PID 证明 socket 是调用进程所持有。
3. **M2：Extra 原生服务。** 从 runner 抽出同一实现，泛型注入业务依赖；与 #66 验证尾部事件、存储归属、占额和 incomplete。Gateway 关闭必须留下共享 Kernel 和其他 Run。
4. **M3：消费者。** 迁移 CLI、Playboard、三个 Extra、fixtures 和脚本，删除旧实现/导出/entry，不保留临时兼容层作为交付。
5. **M4：发行与文档。** 严格编译包外普通 SDK fixtures，安装实际 tgz 验证，更新指南/规则与 release 检查。消费者通过上游正式交付引用，不依赖未合并私有 Runtime 补丁。
6. **M5：库内验收。** 以 CLI 直接加载公共 SDK、实际服务进程拓扑、包外 SDK、共同调用和清理行为为主要验收，逐项写 journal。真实 Electron 专项留在外部集成跟踪，不阻塞此次库内实施；未验不标通过，不因此宣称上游 issue 的外部集成验收全部完成。

本阶段无 Git 提交。后续提交须有用户授权，保留配置的作者，并使用英文 commit message；Codex 实现的变更按用户要求保留唯一 Co-authored-by trailer。GitHub issue/PR 使用英文。
