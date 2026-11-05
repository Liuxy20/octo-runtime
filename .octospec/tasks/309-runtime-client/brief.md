---
type: Task
title: Issue 309：独立客户端与双包发行
description: 明确独立客户端的背景、目标、收益、风险，以及同版本双包发布的责任和验收边界。
tags: [architecture, protocol, lifecycle, packaging, release, testing]
---

# Issue 309 需求简报

状态：**已按确认方案完成本地实现与验证**，实际结果见[验证记录](validation.md)及[两轴审查](review.md)。用户先要求完成 OctoSpec 和 95 分可执行性评估，再确认 runtime 内置 client、client 独立发布并授权实施。规划阶段的提前代码草稿已按新设计修正；完成两轴审查后，用户追加授权英文提交、推送并向 main 创建 PR。合并、打 tag 和正式发布未授权。

来源：[Issue #309](https://github.com/Mininglamp-OSS/octo-runtime/issues/309) 及用户要求“每次发布同时 npm publish runtime、client 两个包”。主线核对基线为 `origin/main@de3ff37a`；新 worktree 为 `octo-runtime-issue-309-runtime-client`，分支为 `codex/issue-309-runtime-client`。以下源码事实按该基线核对。

## 背景

第三方业务应用需要连接一个宿主已经启动的 Kernel，并消费执行协议。当前公开 npm 包只有 `@mininglamp-oss/octo-runtime`，安装它会同时取得 CLI、Core、Kernel 服务端、Adapter、Host SDK 和 Extra 的生产依赖。仅导入 `/executor-kernel` 不能减少实际安装闭包。

现有 `executor-kernel/src/client.ts` 已经提供 `attachKernel({ endpoint })`，负责本地 RPC、执行提交、订阅、交互、取消和有界恢复；KernelService、CLI 与 Extra IPC 可以复用这份实现。缺口在模块依赖和发行边界，不是缺少第二个客户端。

客户端的公共类型引用 Core 的 `HostedAdapterMetadata`，端点校验引用同时包含 Home 文件系统操作的 `runtime-home.ts`。直接把 client.ts 包成新包，会把类型或服务端依赖带回去。发布流程目前也只识别一个归档、一份 npm 完整性和一个 npm latest。

必须按当前主线修正 issue 中的历史背景：#294 后 Kernel 在宿主进程原生装配 Core 和 Adapter，不启动旧执行 worker；#312 已支持 Extra 显式 direct/IPC。此次拆包不恢复 worker、launcher 或强制所有 Extra 经过 IPC。[#293](https://github.com/Mininglamp-OSS/octo-runtime/issues/293) 的文档协调采用当前实现事实。

## 目标

1. 业务应用只安装 `@mininglamp-oss/octo-runtime-client`，就能严格类型检查、读取协议/schema，并连接已有的本地 Kernel。
2. CLI、KernelService.client、Extra IPC 和第三方应用使用同一份客户端与调用登记/恢复实现。
3. client 的运行和 `.d.ts` 依赖闭包不包含完整 Runtime、Kernel 服务端、Core、Host SDK、Adapter 或 Extra。
4. 同一个稳定 tag `vX.Y.Z` 产出并发布 `@mininglamp-oss/octo-runtime@X.Y.Z` 与 `@mininglamp-oss/octo-runtime-client@X.Y.Z`。两个包各有 tgz、npm integrity 和 GitHub Release 附件；只发布一个包不算本次发行完成。
5. 完整 SDK 保留现有原生服务、直接 Core、Extra direct/IPC，以及兼容的客户端/协议公开入口。
6. 明确各发行物内的值身份及跨发行物边界、跨进程协议兼容、部分发布恢复、单归档离线安装和验证边界。

包名沿用现有 scope `@mininglamp-oss`；本任务不发布无 scope 的同名包。

## 收益与成本

| 使用方 | 预期收益 | 可观察依据 |
| --- | --- | --- |
| 只消费 Kernel 的业务应用 | 安装闭包只含 client 和共享 protocol，不承担服务端与 Provider 依赖 | client 单包在空缓存、无工作区的外部项目安装；归档和依赖清单中无禁止模块 |
| CLI、原生 Kernel/GUI 宿主、Extra IPC | 提交、取消、交互、恢复和错误语义共同维护 | 调用链转发到同一 client；生命周期回归和双包对象身份通过 |
| SDK 使用者 | 按“消费已有服务/拥有服务”选择包，保留完整原生集成 | 双语场景表与包外示例一致，旧 full SDK 路径仍可编译运行 |
| 发行维护者 | 同 tag、同版本、两个可独立安装的公开产物 | 两份 manifest/元数据/完整性一致性及部分发布恢复记录 |

约束：完整包将 client 和 protocol 物化到包内 node_modules，单 runtime tgz 必须继续可离线安装；独立 client tgz 只携带 client/protocol。发布必须管理两个不可原子提交的 npm 写入。预计 client 的安装体积更小，但本阶段不声称体积、启动时间、吞吐或内存已经改善；实施时记录 tgz 压缩字节、解包字节和依赖数量。

## 产品意图与关键合同

| 检查项 | 责任 |
| --- | --- |
| 真实业务动作 | 业务应用使用宿主提供的 endpoint 调用已有 Kernel |
| 决定权与显式输入 | 宿主选择服务拓扑、Adapter、endpoint、配置、会话及关闭顺序；业务显式提供 InvokeInput 和控制动作 |
| Runtime 合同内动作 | 校验、传输、调用登记、有界恢复、真实错误/终态与所属资源清理 |
| 不得代替宿主决定 | 安装或启动服务、自动重放未知执行、重置 Home/身份、创建数据库、补造业务会话或 Provider 默认 |
| 对其他产品的影响 | 原生 Kernel/Extra 工厂与直接 Core 保持；Electron 不通过外部 Node/CLI 代启；Extra direct 不增加 client 连接 |

- client.close() 仅释放 client 连接；取消 ACK、执行终态、观察结束、业务投递和资源回收分别报告。
- 执行 ACK 丢失只查询原身份，订阅恢复只续读原实例/游标，未知控制动作不得自动重试。
- 完整 Runtime 向 client/protocol 依赖，client 不得反向依赖服务实现；声明依赖遵守同一边界。
- npm 包版本、IPC/Run/Context 版本与 schema 来源是三个概念，不能以 npm 相同版本替代 wire 合同检查。
- 保留 GitHub CI 范围；新专项只放 `test/manual/`，不进入默认 selector、job 步骤或 Gate。发行步骤处理第二个产物属于用户要求的双包发行，不授权新增检查。

## 风险与范围外

主要风险是发行物内部重复依赖破坏错误/协议值身份、跨发行物误用 instanceof、`.d.ts` 泄漏 Core、部分发布造成两包不一致、离线/全局安装和生命周期移动后的回归。逐项处置和停止条件见[设计](design.md)与[评分](assessment.md)。

范围外：第三个公开 protocol 包、独立版本节奏、浏览器/HTTP/远程认证/设备路由、新协议协商、旧 worker 恢复、执行调度重写、Provider 安装、宿主数据库与真实 Electron 产品改造。历史已发布 tag 不改写、不补发 client；本期双包恢复合同从首次采用新打包器的 tag 开始。

## 规划交付与完成定义

[设计](design.md)锁定 API 和失败合同；[实施计划](plan.md)定义文件、顺序与出口；[验收矩阵](acceptance.md)定义可观察通过条件；[可执行性评估](assessment.md)给出 **95/100 自评**及剩余 5 分。本分数只表示方案准备度，不表示实现或测试完成。

本轮先更新发布约束，再实施并逐项验证；既有代码草稿须按新设计修正。实现、平台、真实 Provider 和 npm 发布结果均须另记，不能用本次评分替代。
