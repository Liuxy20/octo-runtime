---
type: Assessment
title: Issue 71 库内架构合理性与方案可执行性
description: 评估 octo-runtime 自身的服务装配与执行分层，以 CLI 直接加载公共 SDK 验证共同实现。
tags: [architecture, lifecycle, testing, ipc, invoke]
status: ready-for-library-implementation
---

# 结论

以下评分保留最初 fae6333 基线的规划判断。当前已改用 main@70f0247；#73 完成共享 invoke 和调用登记，#72 完成 Gateway 排空与失败处理，第 2 项不再属于待实现缺口。最新实施范围、独立评审待修项与证据以[实施记录](implementation.md)为准，不从旧评分推导当前缺口。

库的执行分层合理：Kernel 管 IPC、接纳和 Run，内部 worker/Core 执行，Adapter 处理 Provider，Extra 处理业务。最新 main 中仍需修正的是 SDK 装配：startOwnedKernel 又启动顶层 Kernel，startExtra 把可复用初始化绑定到 runner。业务使用 KernelClient RPC 本身不要求资源托管或手动触发调用登记。

本次改造是收敛已有库内实现，不需要先研究外部 Electron 工程。CLI 服务入口直接使用公共 SDK，验证其构造、初始化、调用、状态和关闭，是本次主要验证路径。其他原生宿主使用相同合同；不为其设计单独路径。外部应用打包或运行环境问题不计作库内架构缺口，也不作为此次实施前置条件。

## 方案可执行性：92/100

这是本任务库内改造方案的可执行性判断，不是现有实现得分、完成率或成功概率。评分日期为 2026-10-20，源码基线为 fae6333。前次 76 分混入了外部 Electron 集成范围，并把常规实施细节放大为架构阻塞，本次纠正评分口径。

| 维度 | 得分 | 判断依据 |
| --- | --- | --- |
| 需求和责任边界 | 20/20 | 严格原生构造、统一 API、Gateway 不拥有 Kernel 已明确 |
| 已有实现复用 | 19/20 | startKernelServer 已能在调用进程监听，ExtraPlugins 和 Core 可复用，无需重写执行引擎 |
| 公共接口收敛 | 18/20 | 服务工厂与生命周期已规划，需落实共同 invoke 和所属 Run 的内部管理 |
| 生命周期迁移 | 17/20 | 已有取消、排空和清理机制，需防止迁移时破坏尾流与资源释放顺序 |
| 迁移和库内验证 | 18/20 | 调用方映射和验收已明确，需落地 CLI 原生拓扑与包外 SDK 测试 |
| 合计 | 92/100 | 可以进入库内开发，不存在已知必须先解决的外部架构前置条件 |

## 剩余库内工作

1. **抽出真正的原生服务。** 复用现有 Kernel server 与 ExtraPlugins，把 runner 中的通用装配移入普通模块；CLI run 直接调用。删除 launcher 及其导出、类型和消费路径，不改名保留。
2. **收敛 invoke 与所属 Run 管理。** 结合 #69，将唯一 invoke 放在 KernelClient；复用现有接纳/查回/续流。Extra 所属调用的登记、取消和排空仍要保留，但不能成为第二套执行 API。
3. **保持清理顺序。** 结合 #66，停止新任务后处理所属 Run 尾流和终态写入，再释放 owned 资源；重复关闭、初始化失败和 incomplete 如实返回。这里是迁移要做对的实现工作，不是新的架构选型。

共同类型文件位置、fixture 文件名、状态表细化属于普通实施细节，不单列 P0。内部 worker 沿既有执行隔离职责复用，不因外部宿主假设发起一轮 worker 机制重设计。

## 库内通过标准

- CLI 的 Kernel/Gateway 服务进程直接调用同一套公共 SDK 工厂，服务 socket PID 等于调用进程 PID，无冗余顶层服务进程。
- 包外普通 SDK fixture 使用相同公共 API，严格类型检查通过，无 CLI 依赖或私有源码导入。
- invoke、取消、交互、断流、初始化失败、重复 close 和 scoped shutdown 回归通过。
- 删除旧 launcher 后，发行声明、指南和 CLI 路径一致，现有 Home、身份、配置和业务数据保持。

原 [验收矩阵](acceptance.md)中的真实 Electron 专项保留为外部集成验证记录，不纳入此次库内阻塞项，不标记为已通过。CLI 同源验证能证明库的共同逻辑，但不表述为所有外部宿主环境已经实测通过。
