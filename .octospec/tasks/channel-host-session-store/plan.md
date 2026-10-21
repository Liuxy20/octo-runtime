---
type: Design
title: 宿主存储接线设计与实施步骤
description: 基于原生 Extra 服务补齐逐 Bot 句柄及业务公共入口，复用现有 Kernel 调用和关闭期限。
tags: [architecture, extra, lifecycle, channel, session, storage]
---

# 公共接入合同

接入目的、存储内容及默认内存与 SQLite 的选择见 [ImSessionStore 说明](session-store-explained.md)。Electron 主进程持有自己的数据库，以宿主实现的工厂返回逐 Bot 句柄；整个 octo-runtime 不依赖 SQLite，不提供其驱动、适配实现、表结构或迁移；这些均属于宿主。公开示例须解释重启续聊的收益、消息快照的落盘范围和共享数据库的关闭顺序。

根目录两篇 SDK 指南已补充业务类型入口、依赖装配、方法合同和 submodule 操作。工厂已接通真实消费路径，实际验证记录见[实施记录](implementation.md)；消费方不依赖功能分支或私有 Runtime 补丁。submodule 首次接入及主动升级跟踪最新远端 main，宿主记录验收后的实际 commit 供 CI 复现。

以下为公共接口节选；endpoint、配置及工厂由宿主提供，完整可运行版本见[样例](../../../test-support/public-extra/gateway-store.mts)：

```ts
import { createExtraService } from "@mininglamp-oss/octo-runtime/host";
import type { JsonObject } from "@mininglamp-oss/octo-runtime/extra";
import * as gateway from "@mininglamp-oss/octo-runtime/extras/channel-gateway";
import type {
  GatewayDependencies,
  ImSessionStore
} from "@mininglamp-oss/octo-runtime/extras/channel-gateway";

declare const endpoint: string;
declare const config: JsonObject;
// 宿主按可信 Bot/scope 配置返回独立句柄；close 不关闭共享数据库。
declare const createSessionStore: (bot: JsonObject) => ImSessionStore;
const dependencies: GatewayDependencies = { createSessionStore };
const service = createExtraService({ endpoint, module: gateway, config, dependencies });
await service.initialize();
const cleanup = await service.close();
// complete=false 时保留故障事实，宿主不得直接重建同名实例或假定数据库已安全释放。
if (!cleanup.complete) throw new Error("EXTRA_CLEANUP_INCOMPLETE");
```

`GatewayDependencies` 在 Gateway 包定义，扩展现有 `ChannelDependencies`。工厂和常规读写为同步合同；只有句柄 `close?: () => void | Promise<void>` 可异步。工厂不能返回 Promise，避免建立异步存储准入及整套方法异步迁移。同步阻塞仍阻塞宿主线程，不承诺 timer 可中断同步代码。

`/extras/channel-gateway` 至少提供 `GatewayDependencies`、`ImSessionStore`、`ImSessionBinding`、`ImSessionOccurrence`，并核对可选方法、occurrence 快照和 Provider binding 所引用的 gap/rules/输入类型是否均可从业务入口或既有 `/protocol` 公共入口命名。声明不能要求消费方安装私有 workspace 包。

`/extra` 保留共享 authoring/loading/execution 合同；未来 bundled Extra 使用 `/extras/<name>`，独立 npm Extra 在自己的包导出模块和依赖类型。原生 Go 服务按既有 native component 启动合同接入，不要求变成 JS module；本轮不实现 Loop。

## 句柄状态与失败

Manager 为每个 Bot 登记 endpoint 记录（Runtime、工厂句柄、固定的关闭 Promise），在 Runtime 构造/start 前登记，以便任何后续异常都能回收。替换流程为等待旧 endpoint 完整关闭，再调用新工厂；不因相同 Bot key 或清理超时覆盖旧记录。

| 阶段 | 允许行为 | 离开条件 |
| --- | --- | --- |
| 创建/校验 | 校验同步返回对象、必需和可选方法，绑定宿主原接收者 | 有效句柄进入 active；失败则尝试释放已取得句柄 |
| active | binding、reset、occurrence 及受支持的 gap/rules 操作 | owner stop、remove/upsert 或初始化回滚 |
| draining | 停新业务；既有工作在共同截止内完成终态保存和收尾 | 消费完成或截止到期 |
| revoked / closing | 所有方法在进入宿主代码前拒绝；只尝试一次实际 close | 实际 close 完成，或失败/未结束 |
| 完整释放 / incomplete | 完整释放允许后续新实例；incomplete 保留失败所有权 | 重复 close 复用原结果，不把迟到回收改写为先前成功 |

访问包装留在 Gateway，通用 SDK 不识别会话方法。包装应保留类方法的 `this`、方法缺失的可选语义及同步异常；不得把可选规则方法补成空实现。draining 中实际发生的保存失败要记入清理结果，即使上层业务捕获异常作诊断。包装层逐项检查 `save/remember/reset/patchGap/invalidateRules/patchRules` 及其他访问异常的传播；集成测试只注入真实收尾路径可达的操作，不在停准入后发起新 reset 充当尾写。

工厂抛错时报告稳定诊断，不能创建默认 Memory。返回不完整对象时尽可能关闭可识别句柄。误用 async 工厂时明确拒绝、消费后台 rejection，对迟到返回的句柄安排一次回收；若仍未完成，保留真实在途和失败事实，不能让未处理 rejection 结束宿主进程。同步工厂重入关闭、初始化挂起和创建后立刻取消均属于所有权测试。

调用者只能通过 Gateway 获得撤权保证；宿主自己持有的原始连接和句柄由宿主管理。`close` 不是关闭整个数据库的指令，SQLite 的 active/draining/closed 租约由宿主实现；Gateway 包装负责自己对返回句柄的使用权限。二者须共享宿主关库顺序，不能仅凭业务 AbortSignal 禁止必要尾写。

## 统一生命周期与拓扑差异

| 动作 | 当前共同合同 / 本轮要求 |
| --- | --- |
| 正常完成 | 消费真实终态和尾部业务操作；句柄保持到 Extra 关闭 |
| owner 关闭 Extra | 原生服务停止新 invoke、排空所属调用，与插件 dispose 并行；Gateway 继续原事件流和必要投递，不把 owner signal 直接传作已接纳调用的 caller signal |
| caller 的 invoke signal 取消 | 提交前不执行；提交后请求取消并保留尾流，正常耗尽后抛原 reason；传输/控制错误优先，不能要求与 owner dispose 的返回值完全相同 |
| 显式 `cancelInvocation` | ACK 仅表示请求结果，真实终态仍从原事件流确认，不把 ACK 转成 iterator 完成 |
| `iterator.return/client.close` | Kernel 路径仅关闭观察；服务 owner 仍负责所属调用；断流沿既有 ref/cursor 恢复，不重新执行 |
| 缺失终态 / lost / 未确认 | 保留结果未知和 incomplete；不能因订阅断开、登记消失或进程退出宣称完成 |
| 直接 Core | 现有 iterator 提前关闭会请求取消，与 Kernel 观察关闭有意不同；不为持久存储改动 Core |
| CLI 与原生宿主 | 同一 `createExtraService`、同一 Gateway 实现；CLI 负责部署进程，原生宿主同进程注入函数。旧 descriptor/runner 执行路径已删除，不复活作兼容路径 |

关闭开始时取得 `shutdownDeadline`，Manager、Runtime 和句柄共用绝对单调期限。Gateway 最多 3 秒 drain，整体不超过现有 4 秒异步等待预算；剩余时间用于撤权和释放，不能额外再等待一个 4/5 秒周期。初始化失败也立即启动取消/排空，不等 initializer 自行结束才撤权。实际资源迟到关闭后仍保留原 incomplete 结果。

## 实施顺序

| 阶段 | 文件与工作 | 完成条件 |
| --- | --- | --- |
| M0 公共合同 | Gateway `ports.ts/extra.ts/index.ts`、`public/channel-gateway.ts`，close 类型及包外 fixture；先列完整方法和引用类型清单 | 普通 `createExtraService` 推导工厂依赖；共享接口不含 Gateway 业务字段；D01–D03 的定义与类型相符 |
| M1 句柄和 Manager | 新 `application/host-session-store.ts`、Manager endpoint/回滚/关闭；保留 Runtime 借用入口 | 工厂被真实消费；所有方法透传，关闭不重复，失败不可替换 |
| M2 接口状态恢复和隔离 | 复用 #65 的场景断言，改用不依赖 SQLite 的宿主 store 替身；真实 Runtime/Manager 读取同一后端替身的新句柄 | 接口状态重新读取、scope/reset/gap/rules 竞态通过；真实 SQLite 文件重开归宿主 A05，不用替身宣称落盘恢复 |
| M3 生命周期联合验证 | 在现有 Kernel/Gateway/Extra 服务测试中补句柄顺序和故障 | 实际 IPC 下尾写先于释放；owner/caller/缺终态/超时及兄弟隔离通过 |
| M4 发行合同验证 | verifier/包外测试、exports 和发行元信息 | tgz 严格类型和加载通过；各公开入口及声明无私有依赖；与文档模块共同检查交付门槛 |
| D 文档独立模块 | 两篇 SDK 指南、Gateway README、Extra authoring 指南、ImSessionStore 方法说明及可执行样例，详见 [D01–D10](documentation.md) | 概念可回答、方法可实现、步骤可执行、样例可编译运行、main 接入可复现；不得仅以文章已写完成验收 |

M0–M4 和 D 的实际完成情况见[实施记录](implementation.md)。D 的概念/方法草稿随 M0 定稿，可运行样例随 M1/M2 完成，收尾与故障说明随 M3 完成，包外及 main 接入核对随 M4/合入后完成；不将全部文档工作推到代码结束后。每个代码阶段同时更新对应的样例与说明。规划时的逐项就绪评估见[可执行性评估](executability.md)。

无需整体 cherry-pick #65；先移植存储及有效断言，再按当前架构补齐，避免恢复已删除的路径。规则只在实现对应行为后更新，并注明默认 Memory 与宿主自选持久化的边界。

## 验证命令与交付

实现后先构建，再执行新增宿主存储回归与现有 `im-session-store`、`gateway-shutdown-drain`、`gateway-runner-drain`、`extra-service-shutdown`、`kernel-invoke*`、`extra-dependency-container` 测试。跨包合同变更运行 `pnpm typecheck`、`pnpm lint`、`pnpm lint:names`、`pnpm format:check` 和 `pnpm test`；保持现有条件跳过可见。

通过 `pnpm pack:release` 生成测试 tgz，用仓库发行验证器核对 exports、生产声明依赖和主包外消费。新增无关 fixture Extra 的自有依赖、类实例依赖、`skipLibCheck=false` 和原生 initialize/status/close。干净提交要求只在获得提交授权后执行，不能把 dirty 包宣称为正式发行验证。

真实联验使用 `https://im-test.deepminer.com.cn/`，分别记录宿主关闭重开、原会话续聊和 Provider 可恢复性；不能用 fake Provider 宣称真实 thread 恢复。能力合入 main 后，Buddy/Electron submodule 按最新远端 main 更新并记录实际 SHA，重跑恢复和切账号；npm 实际发布版本只对采用 npm 的消费方单列。Windows/Linux 以及 Electron 真机证据分别记录。生产发布、PR 和提交遵循后续授权。
